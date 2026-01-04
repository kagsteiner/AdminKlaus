# Admin Klaus 🤖

An AI-powered shell for Unix/Linux system administrators. Describe what you want to do in natural language, and Klaus will plan and execute the commands for you via SSH.

It's great for people like me who did UNIX administration long ago, forgot details of the commands, but can understand what they do if they see them.

## Why the name?

Well, there's the famous German video "Gabelstaplerfahrer Klaus", an instruction video for forklift drivers, showing the day of Klaus, the forklist driver. And things GO WRONG.

## Features

- **Natural Language Interface**: Describe your goals in plain English
- **AI-Powered Planning**: Claude creates a plan and lists the exact commands (the LLM being used is Sonnet 4.5)
- **User Confirmation**: Always asks before executing commands
- **Error Handling**: Stops on failures and asks how to proceed
- **SSH-Based**: Works with any remote server via SSH
- **Context Aware**: Maintains conversation history and command logs
- **Sudo Support**: Handles privileged commands with password input
- **Streaming Support**: Knows streaming commands like pm2 logs and handles them interactively - user has to press "q"

## Quick Start

### Prerequisites

- Node.js 18+ 
- An Anthropic API key
- SSH access to your server(s)

### Installation

```bash
# Clone the repository
git clone <repo-url>
cd admin-klaus

# Install dependencies
npm install

# Create your .env file
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run Admin Klaus
npm start
```

### Usage

1. **Connect to a server**:
   ```
   /connect
   ```
   Follow the prompts to enter SSH credentials, and the sudo password - leave empty if you are sure you will never need admin commands.

2. **Describe your system** (optional but helpful):
   ```
   /system
   > This is a VPS running Ubuntu 22.04 with nginx and Node.js apps
   ```

3. **Ask Klaus to do things**:
   ```
   You> Show me what's using the most disk space
   You> Open port 443 on the firewall
   You> Install and configure nginx as a reverse proxy for my Node.js app on port 3000
   ```

4. **Review and confirm**: Klaus will show you the commands and ask for confirmation before executing.

## Commands

| Command | Description |
|---------|-------------|
| `/connect` | Connect to an SSH server |
| `/system` | Set the system description |
| `/status` | Show connection status and context usage |
| `/clear` | Clear conversation history |
| `/help` | Show help |
| `/quit` | Exit Admin Klaus |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Admin Klaus                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌──────────┐   ┌──────────┐   ┌──────────────────────────┐ │
│  │   CLI    │   │   LLM    │   │    Context Manager       │ │
│  │Interface │◄─►│  Client  │◄─►│  (logs, compaction)      │ │
│  └────┬─────┘   └────┬─────┘   └──────────────────────────┘ │
│       │              │                                       │
│       │         ┌────▼─────┐                                │
│       │         │   SSH    │                                │
│       └────────►│ Manager  │                                │
│                 └────┬─────┘                                │
│                      │                                       │
└──────────────────────┼───────────────────────────────────────┘
                       │ SSH
                       ▼
              ┌─────────────────┐
              │  Remote Server  │
              └─────────────────┘
```

## How It Works

1. **You describe your goal** in natural language
2. **Klaus analyzes** your request and the system context
3. **Klaus creates a plan** with specific bash commands
4. **You review and confirm** each command
5. **Klaus executes** via SSH and monitors the output
6. **On failure**, Klaus stops and asks whether to abort or fix

## Security Notes

- Klaus never stores passwords on disk
- Sudo passwords are cached in memory for the session only
- Klaus never passes a password to the LLM, the passwords (particularly the admin passwords for sudo) are only passed when executing a command.
- All commands require explicit user confirmation
- Logs are stored locally (not sent to the cloud)

To stress the fourth point: I have taken great care that a) you have to confirm every command that Klaus executes, and b) **exactly** the command is then executed without any LLM or other algorithm changing anything to the command.

I have also checked the code and consider it safe. 

## Configuration

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `SSH_HOST` | No | Default SSH host |
| `SSH_PORT` | No | Default SSH port (22) |
| `SSH_USERNAME` | No | Default SSH username |
| `SSH_KEY_PATH` | No | Path to SSH private key |

## License

MIT

