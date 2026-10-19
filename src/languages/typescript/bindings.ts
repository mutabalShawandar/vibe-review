import type { Node } from 'web-tree-sitter';
import type { ImportBinding } from '../../core/types';

/**
 * What an import brings in, read from the syntax around the module name.
 * `source` is the text node inside the quotes, e.g. `./db` in `import { x } from './db'`.
 *
 *   import React, { useState as useS, type FC } from 'react'
 *       -> default React, useState (local useS), FC (type only)
 *   import * as db from './db'              -> the whole module as `db`
 *   export { a as b } from './x'            -> a re-export, no local name is created for `a`
 *   const { a, b: c } = require('m')        -> a, and b (local c)
 *   import('./lazy')                        -> the whole module, no local name
 */
export function bindingsFor(source: Node): ImportBinding[] {
  const statement = source.parent?.parent; // string_fragment -> string -> the statement or call arguments
  if (!statement) {
    return [];
  }

  switch (statement.type) {
    case 'import_statement':
      return importStatementBindings(statement);
    case 'export_statement':
      return exportStatementBindings(statement);
    case 'import_require_clause': // import fs = require('fs')
      return [whole(statement.firstNamedChild?.text ?? '')];
    case 'arguments':
      return callBindings(statement.parent);
    default:
      return [];
  }
}

function importStatementBindings(statement: Node): ImportBinding[] {
  // `import type { A } from 'x'` marks the whole statement as type-only.
  const wholeStatementIsType = statement.children.some((child) => child?.type === 'type');
  const clause = statement.namedChildren.find((child) => child?.type === 'import_clause');
  if (!clause) {
    return []; // import './styles.css' brings in no names
  }

  const bindings: ImportBinding[] = [];
  for (const part of clause.namedChildren) {
    if (part?.type === 'identifier') {
      bindings.push({ imported: 'default', local: part.text, typeOnly: wholeStatementIsType, reexport: false });
    } else if (part?.type === 'namespace_import') {
      bindings.push({ ...whole(part.firstNamedChild?.text ?? ''), typeOnly: wholeStatementIsType });
    } else if (part?.type === 'named_imports') {
      for (const specifier of part.namedChildren) {
        if (specifier?.type !== 'import_specifier') {
          continue;
        }
        const name = specifier.childForFieldName('name')?.text;
        if (!name) {
          continue;
        }
        bindings.push({
          imported: name,
          local: specifier.childForFieldName('alias')?.text ?? name,
          // `import { type A }` marks just this name.
          typeOnly: wholeStatementIsType || specifier.children.some((child) => child?.type === 'type'),
          reexport: false,
        });
      }
    }
  }
  return bindings;
}

function exportStatementBindings(statement: Node): ImportBinding[] {
  const bindings: ImportBinding[] = [];
  const typeOnly = statement.children.some((child) => child?.type === 'type');

  for (const child of statement.children) {
    if (child?.type === '*') {
      bindings.push({ imported: '*', local: '', typeOnly, reexport: true }); // export * from './y'
    } else if (child?.type === 'namespace_export') {
      bindings.push({ imported: '*', local: child.firstNamedChild?.text ?? '', typeOnly, reexport: true });
    } else if (child?.type === 'export_clause') {
      for (const specifier of child.namedChildren) {
        const name = specifier?.childForFieldName('name')?.text;
        if (specifier?.type === 'export_specifier' && name) {
          bindings.push({
            imported: name,
            local: specifier.childForFieldName('alias')?.text ?? name,
            typeOnly,
            reexport: true,
          });
        }
      }
    }
  }
  return bindings;
}

/** `require('x')` and `import('x')`: what the result is assigned to decides the names. */
function callBindings(call: Node | null): ImportBinding[] {
  if (call?.type !== 'call_expression') {
    return [];
  }

  // `await import('x')` and `await require('x')`: the assignment is one level further up.
  let value: Node = call;
  if (value.parent?.type === 'await_expression') {
    value = value.parent;
  }

  const declarator = value.parent;
  const target = declarator?.type === 'variable_declarator' ? declarator.childForFieldName('name') : undefined;

  if (target?.type === 'identifier') {
    return [whole(target.text)]; // const db = require('./db')
  }
  if (target?.type === 'object_pattern') {
    const bindings: ImportBinding[] = [];
    for (const part of target.namedChildren) {
      if (part?.type === 'shorthand_property_identifier_pattern') {
        bindings.push({ imported: part.text, local: part.text, typeOnly: false, reexport: false }); // { a }
      } else if (part?.type === 'pair_pattern') {
        const imported = part.childForFieldName('key')?.text;
        const local = part.childForFieldName('value')?.text;
        if (imported && local) {
          bindings.push({ imported, local, typeOnly: false, reexport: false }); // { a: b }
        }
      }
    }
    return bindings;
  }
  // Used without a name: `require('./side-effect')`, `import('./lazy').then(...)`.
  return [whole('')];
}

/** The whole module under one name (or none), e.g. `import * as db` or a bare `import('./x')`. */
function whole(local: string): ImportBinding {
  return { imported: '*', local, typeOnly: false, reexport: false };
}
