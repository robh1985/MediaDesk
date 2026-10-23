// Syntax highlighting for Notes. Each language is a list of [pattern, class] rules tried left to
// right at every position; the first rule that matches wins. Patterns use only non-capturing
// groups so they can be joined into one regular expression per language.

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const words = (list) => new RegExp(`\\b(?:${list.trim().split(/\s+/).join('|')})\\b`);

// Building blocks shared by many languages.
const R = {
  slashComment: [/\/\/.*/, 'com'],
  blockComment: [/\/\*[\s\S]*?(?:\*\/|$)/, 'com'],
  hashComment: [/#.*/, 'com'],
  dq: [/"(?:[^"\\\n]|\\.)*"?/, 'str'],
  sq: [/'(?:[^'\\\n]|\\.)*'?/, 'str'],
  bt: [/`(?:[^`\\]|\\[\s\S])*`?/, 'str'],
  num: [/\b(?:0[xX][\da-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)[a-zA-Z]*\b|\.\d+\b/, 'num'],
  call: [/\b[A-Za-z_$][\w$]*(?=\s*\()/, 'fn'],
  op: [/[+\-*/%=&|^!<>?:~]+/, 'op'],
};

function clike({ keywords, types = '', constants = 'true false null', extra = [], hash = false, strings = [R.dq, R.sq] }) {
  return [
    R.blockComment, R.slashComment,
    ...(hash ? [[/^[ \t]*#\s*\w+.*/m, 'meta']] : []),
    ...extra,
    ...strings,
    [words(constants), 'num'],
    [words(keywords), 'kw'],
    ...(types ? [[words(types), 'typ']] : []),
    R.num, R.call, R.op,
  ];
}

const JS_KW = 'break case catch class const continue debugger default delete do else export extends finally for from function get if import in instanceof let new of return set static super switch this throw try typeof var void while with yield async await as';
const TS_KW = `${JS_KW} interface type enum implements namespace declare abstract private protected public readonly keyof infer is satisfies module`;
const TS_TYPES = 'string number boolean any unknown never void object symbol bigint Array Record Partial Promise Map Set';

const tagInner = [
  [/^<\/?[\w:.-]+|\/?>$/, 'tag'],
  [/[\w:.-]+(?=\s*=)/, 'attr'],
  R.dq, R.sq,
  [/\b[\w:.-]+\b/, 'attr'],
];
const markup = [
  [/<!--[\s\S]*?(?:-->|$)/, 'com'],
  [/<!\[CDATA\[[\s\S]*?(?:\]\]>|$)/, 'str'],
  [/<![A-Za-z][^>]*>|<\?[\s\S]*?\?>/, 'meta'],
  [/<\/?[A-Za-z][\w:.-]*(?:\s+(?:[^>"']|"[^"]*"|'[^']*')*)?\/?>/, null, tagInner],
  [/&[#\w]+;/, 'num'],
];

const LANGS = {
  text: { name: 'Normal text', exts: ['txt', 'text', 'nfo', 'diz', 'readme', 'me'], rules: [] },
  javascript: { name: 'JavaScript', exts: ['js', 'mjs', 'cjs', 'jsx'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: JS_KW, constants: 'true false null undefined NaN Infinity', strings: [R.bt, R.dq, R.sq],
      extra: [[/\/(?![*/\s])(?:[^/\\\n[]|\\.|\[(?:[^\]\\\n]|\\.)*\])+\/[dgimsuy]*(?=\s*[.,;)\]}]|\s*$)/m, 'str']] }) },
  typescript: { name: 'TypeScript', exts: ['ts', 'tsx', 'mts', 'cts'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: TS_KW, types: TS_TYPES, constants: 'true false null undefined', strings: [R.bt, R.dq, R.sq], extra: [[/@[\w.]+/, 'meta']] }) },
  json: { name: 'JSON', exts: ['json', 'jsonc', 'json5', 'webmanifest', 'har', 'geojson'], comment: ['//'],
    rules: [R.blockComment, R.slashComment, [/"(?:[^"\\\n]|\\.)*"(?=\s*:)/, 'prop'], R.dq, [words('true false null'), 'kw'], R.num, [/[{}[\],:]/, 'punc']] },
  html: { name: 'HTML', exts: ['html', 'htm', 'xhtml', 'shtml', 'vue', 'svelte'], comment: [null, ['<!--', '-->']], rules: markup },
  xml: { name: 'XML', exts: ['xml', 'svg', 'nzb', 'plist', 'xsd', 'xsl', 'xslt', 'rss', 'atom', 'csproj', 'config', 'resx', 'kml', 'gpx', 'opml'], comment: [null, ['<!--', '-->']], rules: markup },
  css: { name: 'CSS', exts: ['css', 'scss', 'sass', 'less', 'styl'], comment: ['//', ['/*', '*/']],
    rules: [R.blockComment, [/(?<![:\w])\/\/.*/, 'com'], R.dq, R.sq, [/@[\w-]+/, 'kw'], [/[$@][\w-]+/, 'var'], [/#[\da-fA-F]{3,8}\b/, 'num'],
      [/[\w-]+(?=\s*:(?!:)[^{;]*[;}])/, 'prop'], [/(?:[.#][\w-]+|::?[\w-]+|\[[^\]]*\])/, 'tag'], [/\b\d*\.?\d+(?:px|em|rem|%|vh|vw|vmin|vmax|s|ms|deg|fr|ch|ex|pt|cm|mm|in)?\b/, 'num'],
      [/![a-z]+/, 'kw'], R.call, [/[{}();,]/, 'punc']] },
  markdown: { name: 'Markdown', exts: ['md', 'markdown', 'mdown', 'mkd'], comment: [null, ['<!--', '-->']],
    rules: [[/^#{1,6}\s.*/m, 'hd'], [/^```[\s\S]*?(?:^```|$(?![\s\S]))/m, 'str'], [/`[^`\n]+`/, 'str'], [/^\s*(?:[-*+]|\d+\.)\s/m, 'kw'], [/^\s*>.*/m, 'com'],
      [/\*\*[^*\n]+\*\*|__[^_\n]+__/, 'strong'], [/\*[^*\n]+\*|\b_[^_\n]+_\b/, 'em'], [/!?\[[^\]\n]*\]\([^)\n]*\)/, 'link'], [/<https?:[^>]+>|https?:\/\/\S+/, 'link'],
      [/^(?:-{3,}|\*{3,}|_{3,})\s*$/m, 'com'], [/<!--[\s\S]*?(?:-->|$)/, 'com']] },
  python: { name: 'Python', exts: ['py', 'pyw', 'pyi', 'rpy'], comment: ['#'],
    rules: [R.hashComment, [/(?:[rRbBuUfF]{0,2})(?:"""[\s\S]*?(?:"""|$(?![\s\S]))|'''[\s\S]*?(?:'''|$(?![\s\S])))/, 'str'], [/[rRbBuUfF]{0,2}(?:"(?:[^"\\\n]|\\.)*"?|'(?:[^'\\\n]|\\.)*'?)/, 'str'],
      [/@[\w.]+/, 'meta'], [words('True False None'), 'num'],
      [words('and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield match case'), 'kw'],
      [words('self cls int str float bool list dict set tuple bytes object print len range open type isinstance super Exception'), 'typ'], R.num, R.call, R.op] },
  ruby: { name: 'Ruby', exts: ['rb', 'rake', 'gemspec', 'ru'], comment: ['#'],
    rules: [R.hashComment, R.dq, R.sq, [/:[A-Za-z_]\w*/, 'num'], [/@{1,2}\w+|\$\w+/, 'var'], [words('true false nil self'), 'num'],
      [words('alias and begin break case class def defined do else elsif end ensure for if in module next not or redo rescue retry return super then undef unless until when while yield require require_relative attr_accessor attr_reader puts'), 'kw'], R.num, R.call, R.op] },
  php: { name: 'PHP', exts: ['php', 'phtml', 'php5', 'php7'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: 'abstract and array as break callable case catch class clone const continue declare default do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield', constants: 'true false null TRUE FALSE NULL', extra: [[/<\?php|\?>/, 'meta'], [/\$\w+/, 'var'], R.hashComment] }) },
  perl: { name: 'Perl', exts: ['pl', 'pm', 't'], comment: ['#'],
    rules: [R.hashComment, R.dq, R.sq, [/[$@%][\w:]+/, 'var'], [words('my our local sub if elsif else unless while until for foreach last next redo return use require package do eval print die warn'), 'kw'], R.num, R.call, R.op] },
  lua: { name: 'Lua', exts: ['lua'], comment: ['--', ['--[[', ']]']],
    rules: [[/--\[\[[\s\S]*?(?:\]\]|$)/, 'com'], [/--.*/, 'com'], [/\[\[[\s\S]*?(?:\]\]|$)/, 'str'], R.dq, R.sq, [words('true false nil'), 'num'],
      [words('and break do else elseif end for function goto if in local not or repeat return then until while'), 'kw'], R.num, R.call, R.op] },
  c: { name: 'C', exts: ['c', 'h'], comment: ['//', ['/*', '*/']],
    rules: clike({ hash: true, keywords: 'auto break case const continue default do else enum extern for goto if inline register restrict return sizeof static struct switch typedef union volatile while', types: 'void char short int long float double signed unsigned bool size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t FILE', constants: 'true false NULL' }) },
  cpp: { name: 'C++', exts: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx', 'ino'], comment: ['//', ['/*', '*/']],
    rules: clike({ hash: true, keywords: 'alignas alignof and asm auto break case catch class const constexpr const_cast continue decltype default delete do dynamic_cast else enum explicit export extern for friend goto if inline mutable namespace new noexcept not operator or private protected public register reinterpret_cast return sizeof static static_assert static_cast struct switch template this throw try typedef typeid typename union using virtual volatile while override final co_await co_return co_yield concept requires', types: 'void char short int long float double signed unsigned bool size_t std string vector map set auto', constants: 'true false nullptr NULL' }) },
  csharp: { name: 'C#', exts: ['cs', 'csx'], comment: ['//', ['/*', '*/']],
    rules: clike({ hash: true, keywords: 'abstract as base break case catch checked class const continue default delegate do else enum event explicit extern finally fixed for foreach goto if implicit in interface internal is lock namespace new operator out override params private protected public readonly ref return sealed sizeof stackalloc static struct switch this throw try typeof unchecked unsafe using virtual volatile while async await var get set init record yield when where', types: 'bool byte char decimal double float int long object sbyte short string uint ulong ushort void dynamic Task List Dictionary', constants: 'true false null', strings: [[/@"(?:[^"]|"")*"?|\$"(?:[^"\\\n]|\\.)*"?/, 'str'], R.dq, R.sq], extra: [[/\[[A-Z]\w*(?:\([^)]*\))?\]/, 'meta']] }) },
  java: { name: 'Java', exts: ['java', 'gradle', 'groovy'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: 'abstract assert break case catch class const continue default do else enum extends final finally for goto if implements import instanceof interface native new package private protected public return static strictfp super switch synchronized this throw throws transient try volatile while var record sealed permits yield', types: 'boolean byte char double float int long short void String Object Integer List Map', extra: [[/@\w+/, 'meta']] }) },
  kotlin: { name: 'Kotlin', exts: ['kt', 'kts'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: 'as break class continue do else for fun if in interface is object package return super this throw try typealias val var when while by catch constructor init finally get set import data sealed open override private protected public internal suspend companion lateinit inline', types: 'Int Long Float Double Boolean String Unit Any List Map', strings: [[/"""[\s\S]*?(?:"""|$)/, 'str'], R.dq, R.sq], extra: [[/@\w+/, 'meta']] }) },
  go: { name: 'Go', exts: ['go'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: 'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var', types: 'bool byte complex64 complex128 error float32 float64 int int8 int16 int32 int64 rune string uint uint8 uint16 uint32 uint64 uintptr any', constants: 'true false nil iota', strings: [R.bt, R.dq, R.sq] }) },
  rust: { name: 'Rust', exts: ['rs'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: 'as async await break const continue crate dyn else enum extern fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait type unsafe use where while', types: 'bool char f32 f64 i8 i16 i32 i64 i128 isize str u8 u16 u32 u64 u128 usize String Vec Option Result Box', constants: 'true false None Some Ok Err', extra: [[/#!?\[[^\]]*\]/, 'meta'], [/\b\w+!/, 'fn'], [/'[a-z_]\w*\b(?!')/, 'var']] }) },
  swift: { name: 'Swift', exts: ['swift'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: 'associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows static struct subscript typealias var break case continue default defer do else fallthrough for guard if in repeat return switch where while as catch is rethrows super self Self throw throws try async await some any', types: 'Int Double Float String Bool Character Array Dictionary Set Optional', constants: 'true false nil', extra: [[/@\w+/, 'meta']] }) },
  dart: { name: 'Dart', exts: ['dart'], comment: ['//', ['/*', '*/']],
    rules: clike({ keywords: 'abstract as assert async await break case catch class const continue default deferred do dynamic else enum export extends extension external factory final finally for get if implements import in is late library mixin new on operator part required rethrow return set static super switch sync this throw try typedef var void while with yield', types: 'int double num String bool List Map Set Future Stream', extra: [[/@\w+/, 'meta']] }) },
  shell: { name: 'Shell (Bash)', exts: ['sh', 'bash', 'zsh', 'ksh', 'fish', 'bashrc', 'zshrc', 'profile', 'command'], comment: ['#'],
    rules: [[/^#!.*/, 'meta'], R.hashComment, R.dq, [/'[^']*'?/, 'str'], [/\$(?:\{[^}]*\}|\(|\w+|[@#?$!*-])/, 'var'],
      [words('if then else elif fi case esac for while until do done in function select time return exit break continue local export readonly declare unset shift source alias'), 'kw'],
      [words('echo printf cd ls cp mv rm mkdir chmod chown grep sed awk cat find xargs test read curl wget sudo apt docker git tar'), 'typ'], [/\b\d+\b/, 'num'], [/[|&;<>]+/, 'op']] },
  powershell: { name: 'PowerShell', exts: ['ps1', 'psm1', 'psd1'], comment: ['#', ['<#', '#>']],
    rules: [[/<#[\s\S]*?(?:#>|$)/, 'com'], R.hashComment, [/@"[\s\S]*?(?:"@|$)/, 'str'], R.dq, [/'(?:[^']|'')*'?/, 'str'], [/\$[\w:]+|\$\{[^}]*\}/, 'var'],
      [/\b(?:if|else|elseif|switch|foreach|for|while|do|until|function|filter|param|begin|process|end|return|break|continue|try|catch|finally|throw|trap|exit|in|class|enum)\b/i, 'kw'],
      [/\b[A-Z][a-z]+-[A-Z][A-Za-z]+\b/, 'fn'], [/-(?:eq|ne|gt|ge|lt|le|like|notlike|match|notmatch|contains|in|notin|and|or|not|is|isnot|replace|split|join)\b/i, 'op'], [/\[[\w.]+\]/, 'typ'], R.num] },
  batch: { name: 'Batch', exts: ['bat', 'cmd', 'btm'], comment: ['REM '],
    rules: [[/^\s*(?:@?rem\b|::).*/im, 'com'], [/^\s*:\w+/m, 'fn'], R.dq, [/%~?[\w]+%?|%%\w|!\w+!/, 'var'],
      [/\b(?:if|else|for|in|do|goto|call|exit|set|setlocal|endlocal|echo|not|exist|defined|errorlevel|equ|neq|lss|leq|gtr|geq|shift|start|pause|cd|pushd|popd|del|copy|move|mkdir|rmdir|title|cls|choice|timeout)\b/i, 'kw'], [/^\s*@?echo\s+off/im, 'kw'], [/\b\d+\b/, 'num'], [/[|&<>]+/, 'op']] },
  sql: { name: 'SQL', exts: ['sql', 'ddl', 'dml', 'psql', 'mysql'], comment: ['--', ['/*', '*/']],
    rules: [R.blockComment, [/--.*/, 'com'], [/'(?:[^']|'')*'?/, 'str'], R.dq, [/`[^`]*`?/, 'str'],
      [/\b(?:select|from|where|and|or|not|insert|into|values|update|set|delete|create|table|view|index|drop|alter|add|column|primary|key|foreign|references|join|inner|left|right|outer|full|cross|on|as|group|by|order|having|limit|offset|union|all|distinct|case|when|then|else|end|is|null|in|between|like|exists|default|unique|constraint|begin|commit|rollback|transaction|with|returning|if|asc|desc|database|schema|grant|revoke|trigger|procedure|function|declare|cast)\b/i, 'kw'],
      [/\b(?:int|integer|bigint|smallint|varchar|char|text|date|datetime|timestamp|boolean|bool|float|real|double|decimal|numeric|blob|json|uuid|serial)\b/i, 'typ'], R.num, R.call, [/[=<>!]+|[*+\-/%]/, 'op']] },
  yaml: { name: 'YAML', exts: ['yml', 'yaml'], comment: ['#'],
    rules: [[/(?:^|\s)#.*/, 'com'], [/^---|^\.\.\./m, 'meta'], [/^[ \t]*-?[ \t]*[\w.\-/ ]+?(?=:(?:\s|$))/m, 'prop'], [/^[ \t]*"[^"\n]*"(?=:)|^[ \t]*'[^'\n]*'(?=:)/m, 'prop'], R.dq, R.sq,
      [/[&*][\w-]+/, 'var'], [/!!?\w+/, 'meta'], [/\b(?:true|false|yes|no|on|off|null)\b|~/i, 'kw'], [/(?<=[:\-]\s+)[+-]?\d[\d_.:]*(?:[eE][+-]?\d+)?\b/, 'num'], [/^[ \t]*-(?=\s)/m, 'punc'], [/[|>][-+]?$/m, 'punc']] },
  toml: { name: 'TOML', exts: ['toml', 'lock'], comment: ['#'],
    rules: [R.hashComment, [/^\s*\[\[?[^\]\n]+\]\]?/m, 'sec'], [/^\s*[\w."'-]+(?=\s*=)/m, 'prop'], [/"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)/, 'str'], R.dq, [/'[^'\n]*'?/, 'str'],
      [/\b(?:true|false)\b/, 'kw'], [/\b\d{4}-\d\d-\d\d(?:[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)?)?\b/, 'num'], R.num] },
  ini: { name: 'INI / Config', exts: ['ini', 'cfg', 'conf', 'cnf', 'properties', 'env', 'editorconfig', 'desktop', 'url', 'inf', 'reg', 'service', 'gitconfig', 'npmrc', 'htaccess', 'prefs'], comment: ['#'],
    rules: [[/^\s*[;#].*/m, 'com'], [/^\s*\[[^\]\n]*\]/m, 'sec'], [/^\s*[^=:\s][^=:\n]*?(?=\s*[=:])/m, 'prop'], R.dq, [/\$\{?\w+\}?|%\w+%/, 'var'], [/\b(?:true|false|yes|no|on|off|enabled|disabled|null)\b/i, 'kw'], [/\b\d+(?:\.\d+)*\b/, 'num'], [/[=:]/, 'op']] },
  dockerfile: { name: 'Dockerfile', exts: ['dockerfile', 'containerfile'], comment: ['#'],
    rules: [R.hashComment, [/^\s*(?:FROM|RUN|CMD|LABEL|MAINTAINER|EXPOSE|ENV|ADD|COPY|ENTRYPOINT|VOLUME|USER|WORKDIR|ARG|ONBUILD|STOPSIGNAL|HEALTHCHECK|SHELL|AS)\b/im, 'kw'], R.dq, R.sq, [/\$\{?\w+\}?/, 'var'], [/\b\d+\b/, 'num']] },
  makefile: { name: 'Makefile', exts: ['mk', 'mak', 'make'], comment: ['#'],
    rules: [R.hashComment, [/^[\w./%-]+(?=\s*:(?!=))/m, 'fn'], [/^\s*[\w.]+(?=\s*[:?+]?=)/m, 'prop'], [/\$\([^)]*\)|\$\{[^}]*\}|\$[@<^*?%]/, 'var'], [/\b(?:ifeq|ifneq|ifdef|ifndef|else|endif|include|define|endef|export|override|\.PHONY)\b/, 'kw'], R.dq, R.sq] },
  nginx: { name: 'Nginx', exts: ['nginx'], comment: ['#'],
    rules: [R.hashComment, R.dq, R.sq, [/\$\w+/, 'var'], [/^\s*[a-z_]+/m, 'kw'], [/\b\d+[kmgsdh]?\b/i, 'num'], [/[{};]/, 'punc']] },
  diff: { name: 'Diff / Patch', exts: ['diff', 'patch', 'rej'],
    rules: [[/^(?:\+\+\+|---).*$/m, 'meta'], [/^@@.*$/m, 'kw'], [/^\+.*$/m, 'ins'], [/^-.*$/m, 'del'], [/^(?:diff|index|similarity|rename|new file|deleted file).*$/m, 'com']] },
  log: { name: 'Log file', exts: ['log', 'out', 'err'],
    rules: [[/\b(?:ERROR|ERR|FATAL|CRITICAL|CRIT|FAIL(?:ED|URE)?|EXCEPTION|Error|Exception|Traceback)\b.*$/m, 'del'], [/\b(?:WARN(?:ING)?|Warn(?:ing)?)\b/, 'warn'], [/\b(?:INFO|Info|NOTICE)\b/, 'kw'], [/\b(?:DEBUG|TRACE|Debug|Trace|VERBOSE)\b/, 'com'],
      [/\b\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:[.,]\d+)?(?:Z|[+-]\d\d:?\d\d)?|\b\d\d:\d\d:\d\d(?:[.,]\d+)?\b|\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/, 'num'], [/https?:\/\/\S+/, 'link'], [/\b(?:\d{1,3}\.){3}\d{1,3}(?::\d+)?\b/, 'typ'], R.dq, [/\[[^\]\n]{1,40}\]/, 'meta']] },
  srt: { name: 'Subtitles (SRT/VTT)', exts: ['srt', 'vtt', 'sbv'],
    rules: [[/^WEBVTT.*$/m, 'meta'], [/^\d+\s*$/m, 'num'], [/\d\d:\d\d(?::\d\d)?[.,]\d\d\d\s*-->\s*\d\d:\d\d(?::\d\d)?[.,]\d\d\d.*$/m, 'kw'], [/<\/?[a-z][^>]*>|\{\\[^}]*\}/i, 'tag'], [/^NOTE\b.*$/m, 'com']] },
  ass: { name: 'Subtitles (ASS/SSA)', exts: ['ass', 'ssa'], comment: [';'],
    rules: [[/^;.*/m, 'com'], [/^\[[^\]]+\]/m, 'sec'], [/^[\w ]+(?=:)/m, 'prop'], [/\{[^}]*\}/, 'tag'], [/\b\d+:\d\d:\d\d\.\d\d\b/, 'num']] },
  m3u: { name: 'Playlist (M3U)', exts: ['m3u', 'm3u8', 'pls'], comment: ['#'],
    rules: [[/^#EXT[\w-]*/m, 'kw'], [/^#.*/m, 'com'], [/https?:\/\/\S+/, 'link'], [/[\w-]+(?==)/, 'attr'], R.dq, [/-?\b\d+(?:\.\d+)?\b/, 'num']] },
  cue: { name: 'CUE sheet', exts: ['cue'], comment: ['REM '],
    rules: [[/^\s*REM\b.*/m, 'com'], [/^\s*(?:FILE|TRACK|INDEX|TITLE|PERFORMER|SONGWRITER|ISRC|FLAGS|PREGAP|POSTGAP|CATALOG|CDTEXTFILE)\b/m, 'kw'], R.dq, [/\b\d\d:\d\d:\d\d\b/, 'num'], [/\b(?:AUDIO|WAVE|MP3|BINARY|MODE\d\/\d+)\b/, 'typ'], [/\b\d+\b/, 'num']] },
  sfv: { name: 'Checksums (SFV/MD5)', exts: ['sfv', 'md5', 'sha1', 'sha256', 'sha512', 'par'], comment: [';'],
    rules: [[/^;.*/m, 'com'], [/\b[\da-fA-F]{8,128}\b/, 'num']] },
  csv: { name: 'CSV', exts: ['csv'], special: 'csv', delimiter: ',' },
  tsv: { name: 'TSV', exts: ['tsv', 'tab'], special: 'csv', delimiter: '\t' },
};

// Which language a file name means.
export function detectLanguage(name = '', text = '') {
  const lower = name.toLowerCase();
  const base = lower.split('/').pop();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile';
  if (base.startsWith('.env')) return 'ini';
  if (['.gitignore', '.dockerignore', '.npmignore', '.gitattributes'].includes(base)) return 'shell';
  if (base.endsWith('nginx.conf') || lower.includes('/nginx/')) return 'nginx';
  const ext = base.includes('.') ? base.split('.').pop() : '';
  // Kodi/Jellyfin .nfo files are usually XML; scene .nfo files are plain text.
  if (ext === 'nfo' && /^\s*</.test(text)) return 'xml';
  for (const [id, l] of Object.entries(LANGS)) if (l.exts.includes(ext)) return id;
  // Guess from the content.
  const head = text.slice(0, 400).trimStart();
  if (/^#!.*\b(?:ba|z|k)?sh\b/.test(head)) return 'shell';
  if (/^#!.*python/.test(head)) return 'python';
  if (/^#!.*node/.test(head)) return 'javascript';
  if (/^<\?xml|^<svg/i.test(head)) return 'xml';
  if (/^<!doctype html|^<html/i.test(head)) return 'html';
  if (/^[{[]/.test(head) && /^[{[][\s\S]*[}\]]\s*$/.test(text.slice(0, 20000).trim())) return 'json';
  return 'text';
}

export const languages = () => Object.entries(LANGS).map(([id, l]) => ({ id, name: l.name, exts: l.exts })).sort((a, b) => (a.id === 'text' ? -1 : b.id === 'text' ? 1 : a.name.localeCompare(b.name)));
export const languageName = (id) => LANGS[id]?.name || 'Normal text';
export const commentStyle = (id) => LANGS[id]?.comment || null;

const compiled = new Map();
function compile(rules) {
  if (!compiled.has(rules)) {
    compiled.set(rules, rules.map(([re, cls, inner]) => ({ re: new RegExp(re.source, [...new Set(`gm${re.flags}`)].join('')), cls, inner })));
  }
  return compiled.get(rules);
}

// At each step, take whichever rule matches earliest (ties go to the earlier rule). Each rule's
// next match is cached until the scan passes it, so every regex runs only a few times per token.
function run(text, rules) {
  if (!rules.length) return esc(text);
  const rs = compile(rules);
  const next = new Array(rs.length).fill(null);
  let out = '', pos = 0;
  while (pos < text.length) {
    let best = -1, bm = null;
    for (let i = 0; i < rs.length; i++) {
      let n = next[i];
      if (n === false) continue;
      if (n === null || n.index < pos) {
        const re = rs[i].re;
        re.lastIndex = pos;
        let m = re.exec(text);
        while (m && m[0] === '') { re.lastIndex = m.index + 1; m = re.exec(text); }
        n = next[i] = m || false;
        if (!m) continue;
      }
      if (!bm || n.index < bm.index) { best = i; bm = n; }
    }
    if (!bm) break;
    const { cls, inner } = rs[best];
    out += esc(text.slice(pos, bm.index));
    const body = inner ? run(bm[0], inner) : esc(bm[0]);
    out += cls ? `<span class="t-${cls}">${body}</span>` : body;
    pos = bm.index + bm[0].length;
  }
  return out + esc(text.slice(pos));
}

function csv(text, delimiter) {
  return text.split('\n').map((line) => {
    let col = 0, out = '', cell = '', quoted = false;
    const flush = (sep) => { out += `<span class="t-c${col % 6}">${esc(cell)}</span>${sep ? `<span class="t-punc">${esc(sep)}</span>` : ''}`; cell = ''; col++; };
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      if (ch === delimiter && !quoted) flush(ch); else cell += ch;
    }
    flush('');
    return out;
  }).join('\n');
}

// Returns HTML for the text.
export function highlight(text, lang) {
  const l = LANGS[lang] || LANGS.text;
  if (l.special === 'csv') return csv(text, l.delimiter);
  return run(text, l.rules);
}
