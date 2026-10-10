---
type: regex
target: trace
pattern: '^(?:(?!(?:"name":"(?:Edit|Write)","input":\{(?:"replace_all":(?:true|false),)?"file_path":"[^"]*/src/amount\.ts"|(?:>>?|\btee(?: -a)?) *(?:\\"|'')?[^\s"''|;&\\]*src/amount\.ts(?![\w.])|\bsed -i(?:(?!\\n)[^"|;&])*src/amount\.ts(?![\w.])))[\s\S])*?(?:AssertionError|ERR_ASSERTION|Missing expected exception|✖ (?!failing tests)(?![^\\"\n]*\.(?:test|spec)\.[cm]?[jt]sx?))'
---
