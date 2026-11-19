---
type: regex
target: trace
pattern: '"command":"(?:[^"\\]|\\.)*?\bgit(?: -C \S+)? (?:(?:switch|checkout)(?: (?:-q|--quiet|--detach|-d|-f|-[cbB] \S+))* |worktree add(?: (?:-f|--detach|-d|-b \S+))* \S+ |archive(?: --\S+)* )(?:origin/)?(?:main|HEAD(?:~\d*|\^+)|[0-9a-f]{7,40}|\$\(git merge-base [^)]*\))(?![\w/.:~^-])(?! --)(?:(?:[^"\\]|\\.)*?|[\s\S]*?"command":"(?:[^"\\]|\\.)*?)\b(?:npm (?:run )?test|node --test)'
---
