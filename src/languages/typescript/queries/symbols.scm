; Top-level declarations that become symbols (the items listed inside a file card).
;
; How to read this file:
;   - Each (...) is a pattern that matches a piece of the syntax tree.
;   - @name   captures the identifier, e.g. `UserService` in `class UserService {}`.
;   - @class, @interface, @function, @type, @enum, @variable capture the WHOLE
;     declaration. Its first and last line become the symbol's line range, which is how
;     we later tell whether a git change touched this symbol.
;   - Only direct children of `program` match, so nested declarations are ignored.
;   - Every declaration has two patterns: plain, and wrapped in `export`.
;     For the exported one we capture the export statement, so `export` is part of the range.

; ---- classes (including abstract ones) ----
(program
  [(class_declaration name: (_) @name)
   (abstract_class_declaration name: (_) @name)] @class)
(program
  (export_statement
    declaration: [(class_declaration name: (_) @name)
                  (abstract_class_declaration name: (_) @name)]) @class)

; ---- interfaces ----
(program (interface_declaration name: (_) @name) @interface)
(program
  (export_statement declaration: (interface_declaration name: (_) @name)) @interface)

; ---- type aliases: `type Props = {...}` ----
(program (type_alias_declaration name: (_) @name) @type)
(program
  (export_statement declaration: (type_alias_declaration name: (_) @name)) @type)

; ---- enums ----
(program (enum_declaration name: (_) @name) @enum)
(program
  (export_statement declaration: (enum_declaration name: (_) @name)) @enum)

; ---- functions: `function f() {}` ----
(program
  [(function_declaration name: (_) @name)
   (generator_function_declaration name: (_) @name)] @function)
(program
  (export_statement
    declaration: [(function_declaration name: (_) @name)
                  (generator_function_declaration name: (_) @name)]) @function)

; ---- functions stored in a variable: `const Page = () => {...}` ----
; Very common in React/Next.js, so shown as functions rather than plain variables.
(program
  [(lexical_declaration
     (variable_declarator
       name: (identifier) @name
       value: [(arrow_function) (function_expression)]))
   (variable_declaration
     (variable_declarator
       name: (identifier) @name
       value: [(arrow_function) (function_expression)]))] @function)
(program
  (export_statement
    declaration: [(lexical_declaration
                    (variable_declarator
                      name: (identifier) @name
                      value: [(arrow_function) (function_expression)]))
                  (variable_declaration
                    (variable_declarator
                      name: (identifier) @name
                      value: [(arrow_function) (function_expression)]))]) @function)

; ---- every other variable: `const limit = 10` ----
; This also matches the arrow-function variables above; the extractor drops the
; duplicate and keeps the more specific "function".
(program
  [(lexical_declaration (variable_declarator name: (identifier) @name))
   (variable_declaration (variable_declarator name: (identifier) @name))] @variable)
(program
  (export_statement
    declaration: [(lexical_declaration (variable_declarator name: (identifier) @name))
                  (variable_declaration (variable_declarator name: (identifier) @name))]) @variable)
