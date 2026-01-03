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

    // Patterns for commands that produce continuous/streaming output
    this.streamingCommandPatterns = [
      /^pm2\s+logs?/i,                    // pm2 logs, pm2 log
      /^tail\s+(-[fF]|--follow)/,         // tail -f, tail -F, tail --follow
      /^journalctl\s+.*-f/,               // journalctl -f (follow)
      /^watch\s+/,                        // watch command
      /^htop(\s|$)/,                      // htop
      /^top(\s|$)/,                       // top
      /^less(\s|$)/,                      // less (interactive)
      /^more(\s|$)/,                      // more (interactive)
      /^vim?(\s|$)/,                      // vi, vim
      /^nano(\s|$)/,                      // nano
      /^docker\s+logs\s+.*-f/,            // docker logs -f
      /^docker-compose\s+logs\s+.*-f/,    // docker-compose logs -f
      /^kubectl\s+logs\s+.*-f/,           // kubectl logs -f
      /^ping\s+/,                         // ping (continuous by default on Linux)
      /^tcpdump(\s|$)/,                   // tcpdump
      /^dmesg\s+.*-w/,                    // dmesg -w (follow)
      /^iostat\s+.*\d+/,                  // iostat with interval
      /^vmstat\s+.*\d+/,                  // vmstat with interval
      /^sar\s+.*\d+/,                     // sar with interval
      /^nmon(\s|$)/,                      // nmon
      /^iotop(\s|$)/,                     // iotop
      /^iftop(\s|$)/,                     // iftop
      /^nethogs(\s|$)/,                   // nethogs
      /^multitail(\s|$)/,                 // multitail
    ];
  }

  /**
   * Check if a command is a streaming command
   */
  isStreamingCommand(command) {
    const trimmedCommand = command.trim();
    return this.streamingCommandPatterns.some(pattern => pattern.test(trimmedCommand));
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
   * Expand path with home directory substitution
   */
  expandPath(keyPath) {
    if (!keyPath) return null;
    return keyPath
      .replace(/^~/, os.homedir())
      .replace(/^\$HOME/, os.homedir())
      .replace(/^%USERPROFILE%/i, os.homedir());
  }

  /**
   * Connect to an SSH server
   */
  async connectToServer() {
    this.cli.print('\n--- SSH Connection Setup ---\n', 'header');

    // Get defaults from environment
    const defaultHost = process.env.SSH_HOST || '';
    const defaultPort = process.env.SSH_PORT || '22';
    const defaultUsername = process.env.SSH_USERNAME || '';
    const defaultKeyPath = process.env.SSH_KEY_PATH || '';

    // Show defaults in prompts
    const hostPrompt = defaultHost ? `Host [${defaultHost}]` : 'Host';
    const host = await this.cli.prompt(hostPrompt) || defaultHost;
    if (!host) {
      this.cli.print('Host is required', 'error');
      return;
    }

    const portPrompt = `Port [${defaultPort}]`;
    const port = await this.cli.prompt(portPrompt) || defaultPort;

    const usernamePrompt = defaultUsername ? `Username [${defaultUsername}]` : 'Username';
    const username = await this.cli.prompt(usernamePrompt) || defaultUsername;
    if (!username) {
      this.cli.print('Username is required', 'error');
      return;
    }

    // Determine auth method - default to key if SSH_KEY_PATH is set
    let authMethod;
    if (defaultKeyPath) {
      this.cli.print('\nAuthentication method:', 'info');
      this.cli.print('  1. Password', 'default');
      this.cli.print(`  2. Private Key [default: ${defaultKeyPath}]`, 'default');
      authMethod = await this.cli.prompt('Choose [2]') || '2';
    } else {
      this.cli.print('\nAuthentication method:', 'info');
      this.cli.print('  1. Password', 'default');
      this.cli.print('  2. Private Key', 'default');
      authMethod = await this.cli.prompt('Choose (1/2)');
    }

    let password, privateKey, passphrase;

    if (authMethod === '2') {
      const keyPathPrompt = defaultKeyPath
        ? `Path to private key [${defaultKeyPath}]`
        : 'Path to private key';
      const keyPath = await this.cli.prompt(keyPathPrompt) || defaultKeyPath;

      if (!keyPath) {
        this.cli.print('Key path is required', 'error');
        return;
      }

      try {
        const expandedPath = this.expandPath(keyPath);
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

      // Ask for optional sudo password
      this.cli.print('\nSudo password (optional - press Enter to skip):', 'info');
      this.cli.print('If you skip, commands requiring sudo will fail.', 'default');
      const sudoPass = await this.cli.promptPassword('Sudo password');
      if (sudoPass) {
        this.sudoPassword = sudoPass;
        this.cli.print('Sudo password saved for this session.', 'success');
      } else {
        this.sudoPassword = null;
        this.cli.print('No sudo password set. Sudo commands will not be available.', 'warning');
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
        return {
          stdout: '',
          stderr: 'Sudo password not configured. Please reconnect with /connect and provide a sudo password when prompted.',
          exitCode: 1,
        };
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
   * Execute a streaming command via SSH (for commands like pm2 logs, tail -f, etc.)
   */
  async executeStreamingCommand(command, requiresSudo = false) {
    const options = {
      onData: (text) => this.cli.printStreamingLine(text),
      onError: (text) => this.cli.printStreamingLine(text),
    };

    if (requiresSudo) {
      if (!this.sudoPassword) {
        return {
          stdout: '',
          stderr: 'Sudo password not configured. Please reconnect with /connect and provide a sudo password when prompted.',
          exitCode: 1,
          aborted: false,
        };
      }
      options.sudo = true;
      options.sudoPassword = this.sudoPassword;
    }

    try {
      // Print the streaming header
      this.cli.printStreamingHeader(command);

      // Start the streaming command
      const { abort, promise } = this.sshManager.executeStreaming(command, options);

      // Set up key capture to abort on 'q'
      const cleanup = this.cli.startStreamingKeyCapture(() => {
        abort();
      });

      // Wait for the command to complete (or be aborted)
      const result = await promise;

      // Clean up key capture
      cleanup();

      // Print the footer
      this.cli.printStreamingFooter(result.aborted);

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
        aborted: false,
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
        const { command, requires_sudo, is_streaming, explanation } = toolCall.input;

        // Auto-detect streaming commands as fallback
        const shouldStream = is_streaming || this.isStreamingCommand(command);

        this.cli.printCommandExecution(command, explanation);

        if (shouldStream) {
          this.cli.print('  (streaming command - press \'q\' to stop)', 'warning');
        }

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

        let result;

        if (shouldStream) {
          // Use streaming execution for continuous output commands
          result = await this.executeStreamingCommand(command, requires_sudo);
        } else {
          // Use regular execution
          const spinner = this.cli.startSpinner('Executing...');
          result = await this.executeCommand(command, requires_sudo);
          spinner.stop(result.exitCode === 0);
          this.cli.printCommandOutput(result.stdout, result.stderr, result.exitCode);
        }

        results.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: JSON.stringify({
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            success: result.exitCode === 0,
            aborted: result.aborted || false,
          }),
        });

        // If command failed (and wasn't intentionally aborted), ask user what to do
        if (result.exitCode !== 0 && !result.aborted) {
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
          // Auto-detect streaming commands as fallback
          const shouldStream = cmd.is_streaming || this.isStreamingCommand(cmd.command);

          this.cli.printCommandExecution(cmd.command, cmd.explanation);

          if (shouldStream) {
            this.cli.print('  (streaming command - press \'q\' to stop)', 'warning');
          }

          const confirmed = await this.cli.confirm('Execute this command?');
          if (!confirmed) {
            sequenceResults.push({
              command: cmd.command,
              skipped: true,
              reason: 'User declined',
            });
            continue;
          }

          let result;

          if (shouldStream) {
            result = await this.executeStreamingCommand(cmd.command, cmd.requires_sudo);
          } else {
            const spinner = this.cli.startSpinner('Executing...');
            result = await this.executeCommand(cmd.command, cmd.requires_sudo);
            spinner.stop(result.exitCode === 0);
            this.cli.printCommandOutput(result.stdout, result.stderr, result.exitCode);
          }

          sequenceResults.push({
            command: cmd.command,
            exitCode: result.exitCode,
            stdout: result.stdout,
            stderr: result.stderr,
            success: result.exitCode === 0,
            aborted: result.aborted || false,
          });

          if (result.exitCode !== 0 && !result.aborted) {
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

