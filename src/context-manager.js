import fs from 'fs/promises';
import path from 'path';

/**
 * Manages conversation context and command logs with smart compaction
 */
export class ContextManager {
  constructor(options = {}) {
    // Claude's context window - we'll use half of it
    this.maxContextTokens = options.maxContextTokens || 100000; // ~200k model, use 100k
    this.halfContext = this.maxContextTokens / 2;
    
    // Approximate tokens per character (rough estimate)
    this.tokensPerChar = 0.25;
    
    // Storage
    this.messages = []; // Conversation messages for API
    this.communicationLog = []; // Human-readable log
    this.commandLog = []; // Command output log
    
    // File paths for persistence
    this.logDir = options.logDir || './logs';
    this.commLogFile = path.join(this.logDir, 'communication.log');
    this.cmdLogFile = path.join(this.logDir, 'commands.log');
  }

  /**
   * Estimate token count for a string
   */
  estimateTokens(text) {
    if (typeof text === 'string') {
      return Math.ceil(text.length * this.tokensPerChar);
    }
    return Math.ceil(JSON.stringify(text).length * this.tokensPerChar);
  }

  /**
   * Add a message to the conversation
   */
  addMessage(role, content) {
    this.messages.push({ role, content });
    
    // Also add to human-readable log
    const timestamp = new Date().toISOString();
    if (role === 'user' && typeof content === 'string') {
      this.communicationLog.push({
        timestamp,
        role: 'User',
        content,
      });
    } else if (role === 'assistant') {
      // Extract text from assistant content
      const textContent = Array.isArray(content)
        ? content.filter(b => b.type === 'text').map(b => b.text).join('\n')
        : content;
      if (textContent) {
        this.communicationLog.push({
          timestamp,
          role: 'Klaus',
          content: textContent,
        });
      }
    }

    // Check if compaction is needed
    this.checkAndCompact();
  }

  /**
   * Add command output to the log
   */
  addCommandOutput(command, output, exitCode, executedAt = new Date()) {
    this.commandLog.push({
      timestamp: executedAt.toISOString(),
      command,
      output,
      exitCode,
      success: exitCode === 0,
    });

    this.checkAndCompact();
  }

  /**
   * Get messages formatted for the API
   */
  getMessages() {
    return this.messages;
  }

  /**
   * Get the communication log as a formatted string
   */
  getCommunicationLogString() {
    return this.communicationLog
      .map(entry => `[${entry.timestamp}] ${entry.role}:\n${entry.content}`)
      .join('\n\n---\n\n');
  }

  /**
   * Get the command log as a formatted string
   */
  getCommandLogString() {
    return this.commandLog
      .map(entry => {
        const status = entry.success ? '✓' : '✗';
        return `[${entry.timestamp}] ${status} $ ${entry.command}\nExit: ${entry.exitCode}\n${entry.output}`;
      })
      .join('\n\n---\n\n');
  }

  /**
   * Check context size and compact if needed
   */
  checkAndCompact() {
    const commLogTokens = this.estimateTokens(this.getCommunicationLogString());
    const cmdLogTokens = this.estimateTokens(this.getCommandLogString());
    const totalTokens = commLogTokens + cmdLogTokens;

    // If total exceeds half the context, start compaction
    if (totalTokens > this.halfContext) {
      console.log('\n[Context Manager] Compacting logs to stay within context limits...\n');

      // First, compact command log to half its size
      if (cmdLogTokens > 0) {
        const targetCmdTokens = cmdLogTokens / 2;
        this.compactCommandLog(targetCmdTokens);
      }

      // If communication log alone is > 33% of context, we'd need LLM compaction
      // For MVP, we'll just trim older messages
      const newCommTokens = this.estimateTokens(this.getCommunicationLogString());
      if (newCommTokens > this.maxContextTokens * 0.33) {
        this.compactCommunicationLog();
      }
    }
  }

  /**
   * Compact command log by removing older entries
   */
  compactCommandLog(targetTokens) {
    while (
      this.commandLog.length > 1 &&
      this.estimateTokens(this.getCommandLogString()) > targetTokens
    ) {
      // Remove oldest entry
      this.commandLog.shift();
    }
  }

  /**
   * Compact communication log by removing older entries
   * In a more advanced version, this would use LLM summarization
   */
  compactCommunicationLog() {
    // Keep at least the last 10 exchanges
    const minKeep = 20;
    
    while (this.communicationLog.length > minKeep) {
      this.communicationLog.shift();
    }

    // Also compact the API messages array
    // Keep system context but remove old exchanges
    while (this.messages.length > minKeep) {
      this.messages.shift();
    }
  }

  /**
   * Save logs to disk
   */
  async saveLogs() {
    try {
      await fs.mkdir(this.logDir, { recursive: true });
      
      await fs.writeFile(
        this.commLogFile,
        this.getCommunicationLogString(),
        'utf-8'
      );
      
      await fs.writeFile(
        this.cmdLogFile,
        this.getCommandLogString(),
        'utf-8'
      );
    } catch (error) {
      console.error('Failed to save logs:', error.message);
    }
  }

  /**
   * Load logs from disk (for session resumption)
   */
  async loadLogs() {
    try {
      // For MVP, we start fresh each session
      // Future: parse and restore logs
      return false;
    } catch {
      return false;
    }
  }

  /**
   * Clear all context
   */
  clear() {
    this.messages = [];
    this.communicationLog = [];
    this.commandLog = [];
  }

  /**
   * Get a summary of current context usage
   */
  getContextStats() {
    const commTokens = this.estimateTokens(this.getCommunicationLogString());
    const cmdTokens = this.estimateTokens(this.getCommandLogString());
    
    return {
      communicationLogTokens: commTokens,
      commandLogTokens: cmdTokens,
      totalTokens: commTokens + cmdTokens,
      maxTokens: this.halfContext,
      usagePercent: ((commTokens + cmdTokens) / this.halfContext * 100).toFixed(1),
    };
  }
}

export default ContextManager;

