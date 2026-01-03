import { Client } from 'ssh2';
import { EventEmitter } from 'events';

/**
 * Manages SSH connections and command execution on remote servers
 */
export class SSHManager extends EventEmitter {
  constructor() {
    super();
    this.connection = null;
    this.config = null;
    this.isConnected = false;
  }

  /**
   * Connect to a remote server
   * @param {Object} config - SSH connection config
   * @param {string} config.host - Hostname or IP
   * @param {number} config.port - SSH port (default 22)
   * @param {string} config.username - SSH username
   * @param {string} [config.password] - SSH password
   * @param {string} [config.privateKey] - Private key content
   * @param {string} [config.passphrase] - Passphrase for private key
   */
  async connect(config) {
    return new Promise((resolve, reject) => {
      this.connection = new Client();
      this.config = config;

      this.connection.on('ready', () => {
        this.isConnected = true;
        this.emit('connected', config.host);
        resolve();
      });

      this.connection.on('error', (err) => {
        this.isConnected = false;
        this.emit('error', err);
        reject(err);
      });

      this.connection.on('close', () => {
        this.isConnected = false;
        this.emit('disconnected');
      });

      this.connection.connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
      });
    });
  }

  /**
   * Execute a command on the remote server
   * @param {string} command - The bash command to execute
   * @param {Object} options - Execution options
   * @param {boolean} options.sudo - Whether to run with sudo
   * @param {string} options.sudoPassword - Password for sudo
   * @param {number} options.timeout - Command timeout in ms (default 60000)
   * @returns {Promise<{stdout: string, stderr: string, exitCode: number}>}
   */
  async execute(command, options = {}) {
    if (!this.isConnected) {
      throw new Error('Not connected to any server');
    }

    const { sudo = false, sudoPassword = '', timeout = 60000 } = options;
    
    // If sudo is requested, wrap the command
    let fullCommand = command;
    if (sudo) {
      // Use -S to read password from stdin, -p '' for empty prompt
      fullCommand = `echo '${sudoPassword.replace(/'/g, "'\\''")}' | sudo -S -p '' ${command}`;
    }

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let timeoutId;

      this.connection.exec(fullCommand, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        // Set timeout
        timeoutId = setTimeout(() => {
          stream.close();
          reject(new Error(`Command timed out after ${timeout}ms`));
        }, timeout);

        stream.on('close', (code) => {
          clearTimeout(timeoutId);
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: code,
          });
        });

        stream.on('data', (data) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data) => {
          stderr += data.toString();
        });
      });
    });
  }

  /**
   * Execute a streaming command on the remote server (for commands like pm2 logs, tail -f, etc.)
   * @param {string} command - The bash command to execute
   * @param {Object} options - Execution options
   * @param {boolean} options.sudo - Whether to run with sudo
   * @param {string} options.sudoPassword - Password for sudo
   * @param {function} options.onData - Callback for stdout data
   * @param {function} options.onError - Callback for stderr data
   * @returns {Promise<{abort: function, promise: Promise}>} - Returns an abort function and a promise
   */
  executeStreaming(command, options = {}) {
    if (!this.isConnected) {
      throw new Error('Not connected to any server');
    }

    const { sudo = false, sudoPassword = '', onData, onError } = options;
    
    // If sudo is requested, wrap the command
    let fullCommand = command;
    if (sudo) {
      fullCommand = `echo '${sudoPassword.replace(/'/g, "'\\''")}' | sudo -S -p '' ${command}`;
    }

    let stream = null;
    let aborted = false;
    let stdout = '';
    let stderr = '';

    const abort = () => {
      aborted = true;
      if (stream) {
        // Send SIGINT (Ctrl+C) to the remote process
        stream.signal('INT');
        // Give it a moment, then close
        setTimeout(() => {
          if (stream) {
            stream.close();
          }
        }, 500);
      }
    };

    const promise = new Promise((resolve, reject) => {
      this.connection.exec(fullCommand, (err, s) => {
        if (err) {
          reject(err);
          return;
        }

        stream = s;

        stream.on('close', (code) => {
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: aborted ? 130 : code, // 130 = terminated by Ctrl+C
            aborted,
          });
        });

        stream.on('data', (data) => {
          const text = data.toString();
          stdout += text;
          if (onData) {
            onData(text);
          }
        });

        stream.stderr.on('data', (data) => {
          const text = data.toString();
          stderr += text;
          if (onError) {
            onError(text);
          }
        });
      });
    });

    return { abort, promise };
  }

  /**
   * Execute multiple commands in sequence
   * @param {string[]} commands - Array of commands
   * @param {Object} options - Same as execute options
   * @returns {Promise<Array<{command: string, stdout: string, stderr: string, exitCode: number}>>}
   */
  async executeMany(commands, options = {}) {
    const results = [];
    
    for (const command of commands) {
      const result = await this.execute(command, options);
      results.push({
        command,
        ...result,
      });
      
      // Stop on non-zero exit code
      if (result.exitCode !== 0) {
        break;
      }
    }
    
    return results;
  }

  /**
   * Test the connection with a simple command
   */
  async testConnection() {
    try {
      const result = await this.execute('echo "Connection OK" && whoami && hostname');
      return {
        success: result.exitCode === 0,
        output: result.stdout,
      };
    } catch (err) {
      return {
        success: false,
        error: err.message,
      };
    }
  }

  /**
   * Disconnect from the server
   */
  disconnect() {
    if (this.connection) {
      this.connection.end();
      this.connection = null;
      this.isConnected = false;
    }
  }
}

export default SSHManager;

