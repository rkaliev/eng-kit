---
type: tool_order
before: { tool: Bash, input_match: 'npm (run )?test|node --test' }
after: { tool: Edit, input_match: 'amount\.ts"' }
---
