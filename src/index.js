#!/usr/bin/env node

import 'dotenv/config';
import fs from 'fs/promises';
import os from 'os';
import { SSHManager } from './ssh-manager.js';
import { LLMClient } from './llm-client.js';
import { ContextManager } from './context-manager.js';
import { CLI } from './cli.js';

/**
 * Admin Klaus - Main Application
 */
class AdminKlaus {
  constructor() {
    this.cli = new CLI();
    this.contextManager = new ContextManager();
    this.sshManager = new SSHManager();
    this.llmClient = null;
    
    this.systemDescription = '';
    this.sshConfig = null;
    this.sudoPassword = null;
  }

  /**
   * Initialize the application
   */
  async init() {
    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      this.cli.print('Error: ANTHROPIC_API_KEY not found in environment', 'error');
      this.cli.print('Please create a .env file with your API key', 'info');
      process.exit(1);
    }

    this.llmClient = new LLMClient(process.env.ANTHROPIC_API_KEY, this.contextManager);
    this.cli.init();
    this.cli.printBanner();

    // Set up SSH event handlers
    this.sshManager.on('connected', (host) => {
      this.cli.print(`Connected to ${host}`, 'success');
    });

    this.sshManager.on('error', (err) => {
      this.cli.print(`SSH Error: ${err.message}`, 'error');
    });

    this.sshManager.on('disconnected', () => {
      this.cli.print('Disconnected from server', 'warning');
    });
  }

  /**
   * Handle slash commands
   */
  async handleCommand(input) {
    const [cmd, ...args] = input.slice(1).split(' ');

    switch (cmd.toLowerCase()) {
      case 'connect':
        await this.connectToServer();
        break;

      case 'system':
        await this.setSystemDescription();
        break;

      case 'status':
        this.showStatus();
        break;

      case 'clear':
        this.contextManager.clear();
        this.cli.print('Conversation cleared', 'success');
        break;

      case 'help':
        this.cli.printBanner();
        break;

      case 'quit':
      case 'exit':
        await this.shutdown();
        break;

      default:
        this.cli.print(`Unknown command: ${cmd}`, 'error');
    }
  }

  /**
   * Connect to an SSH server
   */
  async connectToServer() {
    this.cli.print('\n--- SSH Connection Setup ---\n', 'header');

    const host = await this.cli.prompt('Host');
    const port = await this.cli.prompt('Port (22)') || '22';
    const username = await this.cli.prompt('Username');

    // Ask for auth method
    this.cli.print('\nAuthentication method:', 'info');
    this.cli.print('  1. Password', 'default');
    this.cli.print('  2. Private Key', 'default');
    const authMethod = await this.cli.prompt('Choose (1/2)');

    let password, privateKey, passphrase;

    if (authMethod === '2') {
      const keyPath = await this.cli.prompt('Path to private key');
      try {
        // Handle ~ and $HOME expansion, works on Windows and Unix
        const expandedPath = keyPath
          .replace(/^~/, os.homedir())
          .replace(/^\$HOME/, os.homedir())
          .replace(/^%USERPROFILE%/i, os.homedir());
        privateKey = await fs.readFile(expandedPath, 'utf-8');
      } catch (err) {
        this.cli.print(`Error reading key file: ${err.message}`, 'error');
        return;
      }
      passphrase = await this.cli.promptPassword('Key passphrase (or Enter for none)');
    } else {
      password = await this.cli.promptPassword('Password');
    }

    this.sshConfig = {
      host,
      port: parseInt(port),
      username,
      password,
      privateKey,
      passphrase: passphrase || undefined,
    };

    const spinner = this.cli.startSpinner('Connecting...');

    try {
      await this.sshManager.connect(this.sshConfig);
      spinner.stop(true);

      // Test connection
      const test = await this.sshManager.testConnection();
      if (test.success) {
        this.cli.print(`\n${test.output}\n`, 'success');
      }
    } catch (err) {
      spinner.stop(false);
      this.cli.print(`Connection failed: ${err.message}`, 'error');
      this.sshConfig = null;
    }
  }

  /**
   * Set the system description
   */
  async setSystemDescription() {
    this.cli.print('\nDescribe the system you are managing:', 'info');
    this.cli.print('(This helps Klaus understand the context)', 'default');
    this.systemDescription = await this.cli.prompt('System');
    this.cli.print('System description saved', 'success');
  }

  /**
   * Show current status
   */
  showStatus() {
    this.cli.print('\n--- Status ---\n', 'header');
    
    // Connection status
    this.cli.printConnectionStatus(
      this.sshManager.isConnected,
      this.sshConfig?.host,
      this.sshConfig?.username
    );

    // System description
    if (this.systemDescription) {
      this.cli.print(`System: ${this.systemDescription}`, 'info');
    } else {
      this.cli.print('System: Not set (use /system to set)', 'warning');
    }

    // Context stats
    const stats = this.contextManager.getContextStats();
    this.cli.print(`\nContext usage: ${stats.usagePercent}% (${stats.totalTokens}/${stats.maxTokens} tokens)`, 'default');
  }

  /**
   * Execute a command via SSH
   */
  async executeCommand(command, requiresSudo = false) {
    const options = {};

    if (requiresSudo) {
      if (!this.sudoPassword) {
        this.sudoPassword = await this.cli.promptPassword('Sudo password');
      }
      options.sudo = true;
      options.sudoPassword = this.sudoPassword;
    }

    try {
      const result = await this.sshManager.execute(command, options);
      
      // Log the command output
      this.contextManager.addCommandOutput(
        command,
        result.stdout + (result.stderr ? '\n' + result.stderr : ''),
        result.exitCode
      );

      return result;
    } catch (err) {
      return {
        stdout: '',
        stderr: err.message,
        exitCode: 1,
      };
    }
  }

  /**
   * Handle tool calls from the LLM
   */
  async handleToolCalls(toolCalls) {
    const results = [];

    for (const toolCall of toolCalls) {
      if (toolCall.name === 'execute_command') {
        const { command, requires_sudo, explanation } = toolCall.input;

        this.cli.printCommandExecution(command, explanation);

        // Ask for confirmation
        const confirmed = await this.cli.confirm('Execute this command?');

        if (!confirmed) {
          results.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: 'User declined to execute this command.',
          });
          continue;
        }

        // Execute the command
        const spinner = this.cli.startSpinner('Executing...');
        const result = await this.executeCommand(command, requires_sudo);
        spinner.stop(result.exitCode === 0);

        this.cli.printCommandOutput(result.stdout, result.stderr, result.exitCode);

        results.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify({
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            success: result.exitCode === 0,
          }),
        });

        // If command failed, ask user what to do
        if (result.exitCode !== 0) {
          this.cli.print('Command failed!', 'error');
          const shouldContinue = await this.cli.confirm('Continue with next commands?');
          if (!shouldContinue) {
            results.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: 'User chose to abort after command failure.',
            });
            break;
          }
        }
      } else if (toolCall.name === 'execute_command_sequence') {
        const { commands } = toolCall.input;
        const sequenceResults = [];

        for (const cmd of commands) {
          this.cli.printCommandExecution(cmd.command, cmd.explanation);

          const confirmed = await this.cli.confirm('Execute this command?');
          if (!confirmed) {
            sequenceResults.push({
              command: cmd.command,
              skipped: true,
              reason: 'User declined',
            });
            continue;
          }

          const spinner = this.cli.startSpinner('Executing...');
          const result = await this.executeCommand(cmd.command, cmd.requires_sudo);
          spinner.stop(result.exitCode === 0);

          this.cli.printCommandOutput(result.stdout, result.stderr, result.exitCode);

          sequenceResults.push({
            command: cmd.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            success: result.exitCode === 0,
          });

          if (result.exitCode !== 0) {
            this.cli.print('Command failed!', 'error');
            const shouldContinue = await this.cli.confirm('Continue with remaining commands?');
            if (!shouldContinue) {
              break;
            }
          }
        }

        results.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify(sequenceResults),
        });
      }
    }

    return results;
  }

  /**
   * Process a user message through the LLM
   */
  async processMessage(message) {
    if (!this.sshManager.isConnected) {
      this.cli.print('Not connected to any server. Use /connect first.', 'warning');
      return;
    }

    const spinner = this.cli.startSpinner('Klaus is thinking...');

    try {
      let response = await this.llmClient.chat(message, this.systemDescription);
      spinner.stop(true);

      // Print the response
      if (response.response) {
        this.cli.printKlausResponse(response.response);
      }

      // Handle any tool calls
      while (response.toolCalls) {
        const toolResults = await this.handleToolCalls(response.toolCalls);

        if (toolResults.length > 0) {
          const spinner2 = this.cli.startSpinner('Klaus is analyzing results...');
          response = await this.llmClient.continueWithToolResults(toolResults, this.systemDescription);
          spinner2.stop(true);

          if (response.response) {
            this.cli.printKlausResponse(response.response);
          }
        } else {
          break;
        }
      }
    } catch (err) {
      spinner.stop(false);
      this.cli.print(`Error: ${err.message}`, 'error');
    }
  }

  /**
   * Main REPL loop
   */
  async run() {
    await this.init();

    this.cli.print('Welcome! Use /connect to connect to a server, or /help for commands.\n', 'info');

    while (true) {
      try {
        const input = await this.cli.prompt('You');

        if (!input) {
          continue;
        }

        if (input.startsWith('/')) {
          await this.handleCommand(input);
        } else {
          await this.processMessage(input);
        }

        // Save logs periodically
        await this.contextManager.saveLogs();
      } catch (err) {
        if (err.code === 'ERR_USE_AFTER_CLOSE') {
          break;
        }
        this.cli.print(`Error: ${err.message}`, 'error');
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    this.cli.print('\nShutting down...', 'info');
    
    // Save final logs
    await this.contextManager.saveLogs();
    
    // Disconnect SSH
    this.sshManager.disconnect();
    
    // Close CLI
    this.cli.close();
    
    this.cli.print('Goodbye! 👋\n', 'success');
    process.exit(0);
  }
}

// Run the application
const klaus = new AdminKlaus();
klaus.run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});

