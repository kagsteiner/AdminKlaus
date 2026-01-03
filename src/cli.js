import readline from 'readline';
import chalk from 'chalk';

/**
 * CLI interface for Admin Klaus
 */
export class CLI {
  constructor() {
    this.rl = null;
  }

  /**
   * Initialize the readline interface
   */
  init() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Handle Ctrl+C gracefully
    this.rl.on('SIGINT', () => {
      this.print('\n\nGoodbye! 👋\n', 'info');
      process.exit(0);
    });
  }

  /**
   * Print the welcome banner
   */
  printBanner() {
    console.log(chalk.cyan(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║     ${chalk.bold('Admin Klaus')} - AI Shell for System Administrators        ║
║                                                               ║
║     Your intelligent assistant for server management         ║
║     Type your requests in natural language                   ║
║                                                               ║
║     Commands:                                                 ║
║       ${chalk.yellow('/connect')}  - Connect to a server                       ║
║       ${chalk.yellow('/system')}   - Set system description                    ║
║       ${chalk.yellow('/status')}   - Show connection status                    ║
║       ${chalk.yellow('/clear')}    - Clear conversation                        ║
║       ${chalk.yellow('/help')}     - Show this help                            ║
║       ${chalk.yellow('/quit')}     - Exit Admin Klaus                          ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
`));
  }

  /**
   * Print a message with formatting
   */
  print(message, type = 'default') {
    const formats = {
      default: (m) => m,
      info: (m) => chalk.cyan(m),
      success: (m) => chalk.green(m),
      error: (m) => chalk.red(m),
      warning: (m) => chalk.yellow(m),
      klaus: (m) => chalk.white(m),
      command: (m) => chalk.gray(m),
      header: (m) => chalk.bold.cyan(m),
    };

    const formatter = formats[type] || formats.default;
    console.log(formatter(message));
  }

  /**
   * Print Klaus's response with nice formatting
   */
  printKlausResponse(response) {
    console.log();
    console.log(chalk.cyan.bold('┌─ Klaus ─────────────────────────────────────────────'));
    console.log(chalk.cyan('│'));

    // Format the response with proper indentation
    const lines = response.split('\n');
    for (const line of lines) {
      console.log(chalk.cyan('│  ') + chalk.white(line));
    }

    console.log(chalk.cyan('│'));
    console.log(chalk.cyan.bold('└─────────────────────────────────────────────────────'));
    console.log();
  }

  /**
   * Print command execution info
   */
  printCommandExecution(command, explanation) {
    console.log();
    console.log(chalk.yellow.bold('┌─ Executing Command ─────────────────────────────────'));
    console.log(chalk.yellow('│'));
    console.log(chalk.yellow('│  ') + chalk.gray(explanation));
    console.log(chalk.yellow('│  ') + chalk.white.bold('$ ' + command));
    console.log(chalk.yellow('│'));
    console.log(chalk.yellow.bold('└─────────────────────────────────────────────────────'));
  }

  /**
   * Print command output
   */
  printCommandOutput(stdout, stderr, exitCode) {
    const isSuccess = exitCode === 0;
    const color = isSuccess ? chalk.green : chalk.red;
    const icon = isSuccess ? '✓' : '✗';

    console.log();
    console.log(color.bold(`┌─ Output (${icon} exit: ${exitCode}) ─────────────────────────────`));

    if (stdout) {
      const lines = stdout.split('\n').slice(0, 50); // Limit output lines
      for (const line of lines) {
        console.log(color('│  ') + line);
      }
      if (stdout.split('\n').length > 50) {
        console.log(color('│  ') + chalk.gray('... (output truncated)'));
      }
    }

    if (stderr) {
      console.log(color('│'));
      console.log(color('│  ') + chalk.red.bold('STDERR:'));
      const lines = stderr.split('\n').slice(0, 20);
      for (const line of lines) {
        console.log(color('│  ') + chalk.red(line));
      }
    }

    console.log(color.bold('└─────────────────────────────────────────────────────'));
    console.log();
  }

  /**
   * Prompt for user input
   */
  async prompt(promptText = 'You') {
    return new Promise((resolve) => {
      this.rl.question(chalk.green.bold(`${promptText}> `), (answer) => {
        resolve(answer.trim());
      });
    });
  }

  /**
   * Ask a yes/no confirmation
   */
  async confirm(question) {
    const answer = await this.prompt(`${question} (y/n)`);
    return answer.toLowerCase().startsWith('y');
  }

  /**
   * Ask for password (hidden input)
   */
  async promptPassword(promptText) {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      const stdout = process.stdout;

      // Pause readline to prevent interference
      if (this.rl) {
        this.rl.pause();
      }

      stdout.write(chalk.yellow(`${promptText}: `));

      // Remove all existing listeners temporarily
      const existingListeners = stdin.listeners('data');
      stdin.removeAllListeners('data');

      stdin.setRawMode(true);
      stdin.resume();
      stdin.setEncoding('utf8');

      let password = '';

      const cleanup = () => {
        stdin.setRawMode(false);
        stdin.removeListener('data', onData);
        // Restore previous listeners
        for (const listener of existingListeners) {
          stdin.on('data', listener);
        }
        // Resume readline
        if (this.rl) {
          this.rl.resume();
        }
      };

      const onData = (char) => {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          cleanup();
          stdout.write('\n');
          resolve(password);
        } else if (char === '\u0003') {
          // Ctrl+C
          cleanup();
          process.exit();
        } else if (char === '\u007F' || char === '\b') {
          // Backspace
          if (password.length > 0) {
            password = password.slice(0, -1);
            stdout.clearLine(0);
            stdout.cursorTo(0);
            stdout.write(chalk.yellow(`${promptText}: `) + '*'.repeat(password.length));
          }
        } else if (char.charCodeAt(0) >= 32) {
          // Only add printable characters
          password += char;
          stdout.write('*');
        }
      };

      stdin.on('data', onData);
    });
  }

  /**
   * Print connection status
   */
  printConnectionStatus(connected, host, username) {
    if (connected) {
      console.log(chalk.green(`\n✓ Connected to ${username}@${host}\n`));
    } else {
      console.log(chalk.yellow('\n⚠ Not connected to any server\n'));
    }
  }

  /**
   * Show a spinner while waiting
   */
  startSpinner(message) {
    const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
    let i = 0;

    process.stdout.write(chalk.cyan(`${frames[0]} ${message}`));

    const interval = setInterval(() => {
      i = (i + 1) % frames.length;
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(chalk.cyan(`${frames[i]} ${message}`));
    }, 80);

    return {
      stop: (success = true) => {
        clearInterval(interval);
        process.stdout.clearLine(0);
        process.stdout.cursorTo(0);
        if (success) {
          console.log(chalk.green(`✓ ${message}`));
        } else {
          console.log(chalk.red(`✗ ${message}`));
        }
      },
    };
  }

  /**
   * Print streaming output header
   */
  printStreamingHeader(command) {
    console.log();
    console.log(chalk.magenta.bold('┌─ Streaming Output ──────────────────────────────────'));
    console.log(chalk.magenta('│  ') + chalk.white.bold('$ ' + command));
    console.log(chalk.magenta('│  ') + chalk.yellow('Press \'q\' to stop streaming'));
    console.log(chalk.magenta.bold('├─────────────────────────────────────────────────────'));
  }

  /**
   * Print streaming output line
   */
  printStreamingLine(text) {
    const lines = text.split('\n');
    for (const line of lines) {
      if (line) {
        console.log(chalk.magenta('│  ') + line);
      }
    }
  }

  /**
   * Print streaming output footer
   */
  printStreamingFooter(aborted) {
    console.log(chalk.magenta.bold('├─────────────────────────────────────────────────────'));
    if (aborted) {
      console.log(chalk.magenta('│  ') + chalk.yellow('Streaming stopped by user'));
    } else {
      console.log(chalk.magenta('│  ') + chalk.green('Streaming completed'));
    }
    console.log(chalk.magenta.bold('└─────────────────────────────────────────────────────'));
    console.log();
  }

  /**
   * Wait for a specific key press during streaming mode
   * Returns a promise that resolves when 'q' is pressed
   * @param {function} onAbort - Callback to call when abort key is pressed
   * @returns {function} - Cleanup function to stop listening
   */
  startStreamingKeyCapture(onAbort) {
    const stdin = process.stdin;

    // Pause readline to prevent interference
    if (this.rl) {
      this.rl.pause();
    }

    // Remove all existing listeners temporarily
    const existingListeners = stdin.listeners('data');
    stdin.removeAllListeners('data');

    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let cleaned = false;

    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;

      stdin.removeListener('data', onData);
      stdin.setRawMode(false);

      // Restore previous listeners
      for (const listener of existingListeners) {
        stdin.on('data', listener);
      }

      // Resume readline after a small delay to ensure buffer is clear
      setTimeout(() => {
        if (this.rl) {
          this.rl.resume();
        }
      }, 10);
    };

    const onData = (key) => {
      if (key === 'q' || key === 'Q' || key === '\u0003') {
        // 'q', 'Q', or Ctrl+C - consume the key and abort
        cleanup();
        onAbort();
      }
      // All other keys are consumed/ignored during streaming
    };

    stdin.on('data', onData);

    return cleanup;
  }

  /**
   * Close the CLI
   */
  close() {
    if (this.rl) {
      this.rl.close();
    }
  }
}

export default CLI;

