---
type: regex
target: trace
pattern: '(?:AssertionError|ERR_ASSERTION|Missing expected exception|✖ (?!failing tests)(?![^\\"\n]*\.test\.ts))[\s\S]*?(?:"name":"(?:Edit|Write)","input":\{(?:"replace_all":(?:true|false),)?"file_path":"[^"]*/src/discount\.ts"|cat > src/discount\.ts)'
---
