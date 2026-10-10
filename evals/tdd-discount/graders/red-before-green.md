---
type: regex
target: trace
pattern: '^(?:(?!(?:"name":"Edit","input":\{(?:"replace_all":(?:true|false),)?"file_path":"[^"]*/src/discount\.ts"|"name":"Write","input":\{"file_path":"[^"]*/src/discount\.ts","content":"(?:[^"\\]|\\.)*?RangeError|(?:>>?|\btee(?: -a)?) *(?:\\"|'')?[^\s"''|;&\\]*src/discount\.ts(?![\w.])(?:(?!\\n[A-Za-z_'']+(?:\\n|"))(?:[^"\\]|\\.))*?RangeError))[\s\S])*?(?:AssertionError|ERR_ASSERTION|Missing expected exception|✖ (?!failing tests)(?![^\\"\n]*\.(?:test|spec)\.[cm]?[jt]sx?))[\s\S]*?(?:"name":"(?:Edit|Write)","input":\{(?:"replace_all":(?:true|false),)?"file_path":"[^"]*/src/discount\.ts"|(?:>>?|\btee(?: -a)?) *(?:\\"|'')?[^\s"''|;&\\]*src/discount\.ts(?![\w.])|\bsed -i(?:(?!\\n)[^"|;&])*src/discount\.ts(?![\w.]))'
---
