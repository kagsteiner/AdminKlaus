# Admin Klaus - an AI shell

Project goal: a node.js app that implements a shell-like environment for unix sysadmins of small servers, where all interaction of the user takes place with an LLM, and where the (agentic) LLM executes bash commands to meet the wishes of the user.

## Key features:
- user can enter a "system description" that describes the purpose of the system the admin works on. For example: "This is a VPS server to run node.js applications that are accessed remotely".
- system keeps its work with the user in two files: 
  a) a communication log that stores all interaction between user and LLM 
  b) a system update log that sttores all output of all commands the system executes as instructed by the LLM.
  The app guarantees that a) and b) do not exceed half of the LLM's context length. a) is more important. If the size of a) + b) exceeds half the context size, then first b) is compacted to half its original size by stripping away the beginning. If a) alone is more than 33% of the context, it will be compacted by asking the LLM to compact these interactions, keeping the most important parts.
- user uses keyboard to describe what he wants to do in the system. Then the LLM will
  1. make a plan how to achieve the user's goal
  2. describe the plan (in brevity) and the list of bash commands to achieve the plan
  3. ask the user for confirmation or changes. If the user wants changes, go back to making a revised plan. 
  4. If the user confirms, then the LLM will execute these commands in a system bash. It will redirect output to a file and then analyze the file and tell the user if the output confirms that the command acted as expected. IMPORTANT: if several commands need to be executed in a row, the LLM always stops, informs the user of the issue, and asks the user whether to abort or to continue. If the user wishes to continue, the LLM will go back to making a revised plan to fix the issue and continue to reach the user's goal.
  5. After executing the plan, the system updates the two files, and updates the user with the results.

  ## Trickiness of admin commands

  It shall be possible for the LLM to also issue commands as an admin user. It is okay to request the admin password from the user for this.

  ## shell editing features

  The MVP has no advanced features like the shell history. I am not convinced that such low-level features make senxe ina an AI shell.
  