---
type: regex
target: trace
pattern: '"command":"(?:[^"\\]|\\.)*?(?:\\n|\b)git(?: -C \S+)? (?:(?:switch|checkout)(?: (?:-q|--quiet|--detach|-d|-f|-[cbB] \S+))* |worktree add(?: (?:-f|--detach|-d|-b \S+))* \S+ |archive(?: --\S+)* )(?:\\")?(?:origin/)?(?:main|HEAD(?:~\d*|\^+)|[0-9a-f]{7,40}|\$\(git merge-base [^)]*\)|\$\{?\w+\}?)(?:\\")?(?![\w/.:~^-])(?! (?![&|;]|\d*>)[^\s"\\])(?:(?:[^"\\]|\\.)*?|[\s\S]*?"command":"(?:[^"\\]|\\.)*?)(?:\\n|\b)(?:npm (?:run )?test|node --test)'
---
