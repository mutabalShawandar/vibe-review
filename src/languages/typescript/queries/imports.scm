; Every way a file can depend on another module. Only the module name matters here:
; @source captures the text inside the quotes, e.g. `./utils` in `import x from "./utils"`.
; Unlike symbols, these match anywhere in the file, not only at the top level,
; because `require(...)` and `import(...)` often appear inside functions.

; import x from "a"      import { y } from "a"      import "a"      import type { T } from "a"
(import_statement source: (string (string_fragment) @source))

; export * from "a"      export { y } from "a"
(export_statement source: (string (string_fragment) @source))

; import fs = require("a")
(import_require_clause source: (string (string_fragment) @source))

; require("a")   (CommonJS)
((call_expression
   function: (identifier) @function
   arguments: (arguments (string (string_fragment) @source)))
 (#eq? @function "require"))

; import("a")   (dynamic import, used for lazy loading)
(call_expression
  function: (import)
  arguments: (arguments (string (string_fragment) @source)))
