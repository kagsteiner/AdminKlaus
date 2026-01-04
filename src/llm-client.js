import Anthropic from '@anthropic-ai/sdk';

/**
 * LLM client for Admin Klaus - handles all AI interactions
 */
export class LLMClient {
  constructor(apiKey, contextManager) {
    this.client = new Anthropic({ apiKey });
    this.contextManager = contextManager;
    this.model = 'claude-sonnet-4-5';
    this.maxTokens = 4096;
  }

  /**
   * Build the system prompt with system description
   */
  buildSystemPrompt(systemDescription) {
    return `You are Admin Klaus, an AI assistant for Unix/Linux system administrators. You help users manage their servers by executing bash commands via SSH.

## System Being Managed
${systemDescription || 'No system description provided. Ask the user to describe the system.'}

## Your Capabilities
You can execute bash commands on the remote server. When the user asks you to do something:

1. **Analyze** the request and determine what needs to be done
2. **Plan** the sequence of bash commands needed
3. **Present** your plan to the user with the exact commands you'll run
4. **Wait** for user confirmation before executing
5. **Execute** commands one by one, analyzing output after each
6. **Report** results and any issues

## Important Rules
- ALWAYS explain what you're about to do before doing it
- ALWAYS ask for confirmation before executing commands
- If a command fails, STOP and inform the user - ask whether to abort or try to fix
- For destructive operations (rm, dd, format, etc.), give extra warnings
- When sudo is needed, indicate this clearly - the system will handle authentication
- For commands that stream continuous output (pm2 logs, tail -f, journalctl -f, watch, htop, etc.), set is_streaming: true so the user can stop them with 'q'

## Response Format
When you need to execute commands, use the execute_command tool. 
When presenting a plan, list commands clearly:
\`\`\`
Command 1: <command>
Command 2: <command>
\`\`\`

Then ask: "Shall I proceed with these commands?"

## Current Session
You have access to the conversation history and command output logs. Use them to maintain context about what has been done.`;
  }

  /**
   * Define the tools the LLM can use
   */
  getTools() {
    return [
      {
        name: 'execute_command',
        description: 'Execute a bash command on the remote server via SSH. Use this after getting user confirmation for your plan.',
        input_schema: {
          type: 'object',
          properties: {
            command: {
              type: 'string',
              description: 'The bash command to execute',
            },
            requires_sudo: {
              type: 'boolean',
              description: 'Whether this command needs sudo privileges',
              default: false,
            },
            is_streaming: {
              type: 'boolean',
              description: 'Set to true for commands that produce continuous output and never terminate on their own (pm2 logs, tail -f, journalctl -f, watch, htop, top, less, etc.). These commands will stream output until the user presses q to stop.',
              default: false,
            },
            explanation: {
              type: 'string',
              description: 'Brief explanation of what this command does',
            },
          },
          required: ['command', 'explanation'],
        },
      },
      {
        name: 'execute_command_sequence',
        description: 'Execute a sequence of bash commands. Each command runs only if the previous succeeded. Use for multi-step operations after user confirmation.',
        input_schema: {
          type: 'object',
          properties: {
            commands: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  command: { type: 'string' },
                  explanation: { type: 'string' },
                  requires_sudo: { type: 'boolean', default: false },
                  is_streaming: { type: 'boolean', default: false, description: 'Set to true for commands that produce continuous output (pm2 logs, tail -f, etc.)' },
                },
                required: ['command', 'explanation'],
              },
              description: 'Array of commands to execute in sequence',
            },
          },
          required: ['commands'],
        },
      },
    ];
  }

  /**
   * Send a message and get a response
   * @param {string} userMessage - The user's input
   * @param {string} systemDescription - Description of the system being managed
   * @returns {Promise<{response: string, toolCalls: Array|null}>}
   */
  async chat(userMessage, systemDescription) {
    // Add user message to context
    this.contextManager.addMessage('user', userMessage);

    // Build messages array from context
    const messages = this.contextManager.getMessages();

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.buildSystemPrompt(systemDescription),
        tools: this.getTools(),
        messages: messages,
      });

      // Process the response
      const textBlocks = response.content.filter(block => block.type === 'text');
      const toolBlocks = response.content.filter(block => block.type === 'tool_use');

      const responseText = textBlocks.map(b => b.text).join('\n');

      // Add assistant response to context
      this.contextManager.addMessage('assistant', response.content);

      return {
        response: responseText,
        toolCalls: toolBlocks.length > 0 ? toolBlocks : null,
        stopReason: response.stop_reason,
      };
    } catch (error) {
      throw new Error(`LLM API error: ${error.message}`);
    }
  }

  /**
   * Continue conversation after tool execution
   * @param {Array} toolResults - Results from tool execution
   * @param {string} systemDescription - System description
   */
  async continueWithToolResults(toolResults, systemDescription) {
    // Add tool results to context
    this.contextManager.addMessage('user', toolResults);

    const messages = this.contextManager.getMessages();

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: this.maxTokens,
        system: this.buildSystemPrompt(systemDescription),
        tools: this.getTools(),
        messages: messages,
      });

      const textBlocks = response.content.filter(block => block.type === 'text');
      const toolBlocks = response.content.filter(block => block.type === 'tool_use');

      const responseText = textBlocks.map(b => b.text).join('\n');

      this.contextManager.addMessage('assistant', response.content);

      return {
        response: responseText,
        toolCalls: toolBlocks.length > 0 ? toolBlocks : null,
        stopReason: response.stop_reason,
      };
    } catch (error) {
      throw new Error(`LLM API error: ${error.message}`);
    }
  }
}

export default LLMClient;

