import { parse } from "acorn";
import { pathToFileURL } from "node:url";

interface AstNode {
  readonly type: string;
  readonly start: number;
  readonly end: number;
  readonly loc?: {
    readonly start: { readonly line: number; readonly column: number };
  };
  readonly [key: string]: unknown;
}

interface Binding {
  readonly kind: "direct" | "namespace" | "commonjs";
  readonly path: string;
  readonly moduleKind: "esm" | "commonjs";
}

export interface TransformIssue {
  readonly code: string;
  readonly message: string;
}

export interface TransformOptions {
  readonly dependency: string;
  readonly format: "module" | "commonjs";
  readonly url: string;
}

export interface TransformResult {
  readonly source: string;
  readonly transformed: boolean;
  readonly issues: readonly TransformIssue[];
}

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly make: (render: (start: number, end: number) => string) => string;
}

const RUNTIME = 'globalThis[Symbol.for("prooftape.runtime.v1")]';

function node(value: unknown): AstNode | undefined {
  if (
    value !== null
    && typeof value === "object"
    && typeof (value as { type?: unknown }).type === "string"
    && typeof (value as { start?: unknown }).start === "number"
    && typeof (value as { end?: unknown }).end === "number"
  ) {
    return value as AstNode;
  }
  return undefined;
}

function walk(root: AstNode, visit: (current: AstNode) => void): void {
  visit(root);
  for (const [key, value] of Object.entries(root)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        const childNode = node(child);
        if (childNode) walk(childNode, visit);
      }
    } else {
      const childNode = node(value);
      if (childNode) walk(childNode, visit);
    }
  }
}

function walkWithAncestors(
  root: AstNode,
  ancestors: readonly AstNode[],
  visit: (current: AstNode, ancestors: readonly AstNode[]) => void,
): void {
  visit(root, ancestors);
  const nextAncestors = [...ancestors, root];
  for (const [key, value] of Object.entries(root)) {
    if (key === "start" || key === "end" || key === "loc") continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        const childNode = node(child);
        if (childNode) walkWithAncestors(childNode, nextAncestors, visit);
      }
    } else {
      const childNode = node(value);
      if (childNode) walkWithAncestors(childNode, nextAncestors, visit);
    }
  }
}

function nameOf(identifier: unknown): string | undefined {
  const candidate = node(identifier);
  return candidate?.type === "Identifier" && typeof candidate.name === "string"
    ? candidate.name
    : undefined;
}

function literalString(value: unknown): string | undefined {
  const candidate = node(value);
  return candidate?.type === "Literal" && typeof candidate.value === "string"
    ? candidate.value
    : undefined;
}

function isDependencySpecifier(specifier: string | undefined, dependency: string): boolean {
  return specifier === dependency || specifier?.startsWith(`${dependency}/`) === true;
}

function subpathPrefix(specifier: string, dependency: string): string {
  return specifier === dependency ? "" : specifier.slice(dependency.length + 1);
}

function joinPath(prefix: string, member: string): string {
  return prefix.length === 0 ? member : `${prefix}.${member}`;
}

function issue(code: string, message: string): TransformIssue {
  return { code, message };
}

function isRequireCall(value: unknown, dependency: string): { call: AstNode; prefix: string } | undefined {
  const call = node(value);
  if (call?.type !== "CallExpression" || nameOf(call.callee) !== "require") return undefined;
  const argumentsValue = Array.isArray(call.arguments) ? call.arguments : [];
  if (argumentsValue.length !== 1) return undefined;
  const specifier = literalString(argumentsValue[0]);
  if (!isDependencySpecifier(specifier, dependency) || specifier === undefined) return undefined;
  return { call, prefix: subpathPrefix(specifier, dependency) };
}

function rootIdentifier(value: unknown): string | undefined {
  let current = node(value);
  while (current?.type === "MemberExpression") current = node(current.object);
  return nameOf(current);
}

function staticMemberName(value: AstNode): string | undefined {
  if (value.computed === true) {
    return literalString(value.property);
  }
  return nameOf(value.property);
}

function patternNames(value: unknown): readonly string[] {
  const pattern = node(value);
  if (!pattern) return [];
  if (pattern.type === "Identifier") return typeof pattern.name === "string" ? [pattern.name] : [];
  if (pattern.type === "RestElement" || pattern.type === "AssignmentPattern") {
    return patternNames(pattern.argument ?? pattern.left);
  }
  if (pattern.type === "ArrayPattern") {
    return (Array.isArray(pattern.elements) ? pattern.elements : [])
      .flatMap((element) => patternNames(element));
  }
  if (pattern.type === "ObjectPattern") {
    return (Array.isArray(pattern.properties) ? pattern.properties : [])
      .flatMap((propertyValue) => {
        const property = node(propertyValue);
        return property?.type === "Property"
          ? patternNames(property.value)
          : patternNames(property?.argument);
      });
  }
  return [];
}

function functionVarNames(scope: AstNode): readonly string[] {
  const names: string[] = [];
  const visit = (current: AstNode): void => {
    if (
      current !== scope
      && (
        current.type === "FunctionDeclaration"
        || current.type === "FunctionExpression"
        || current.type === "ArrowFunctionExpression"
      )
    ) {
      return;
    }
    if (current.type === "VariableDeclaration" && current.kind === "var") {
      for (const declarationValue of Array.isArray(current.declarations)
        ? current.declarations
        : []) {
        names.push(...patternNames(node(declarationValue)?.id));
      }
    }
    for (const [key, value] of Object.entries(current)) {
      if (key === "start" || key === "end" || key === "loc") continue;
      if (Array.isArray(value)) {
        for (const child of value) {
          const childNode = node(child);
          if (childNode) visit(childNode);
        }
      } else {
        const childNode = node(value);
        if (childNode) visit(childNode);
      }
    }
  };
  visit(scope);
  return names;
}

function directScopeDeclarations(scope: AstNode): readonly string[] {
  const names: string[] = [];
  if (
    scope.type === "FunctionDeclaration"
    || scope.type === "FunctionExpression"
    || scope.type === "ArrowFunctionExpression"
  ) {
    for (const parameter of Array.isArray(scope.params) ? scope.params : []) {
      names.push(...patternNames(parameter));
    }
    if (scope.type !== "ArrowFunctionExpression") names.push(...patternNames(scope.id));
    names.push(...functionVarNames(scope));
  }
  if (scope.type === "CatchClause") names.push(...patternNames(scope.param));
  const body = scope.type === "Program" || scope.type === "BlockStatement"
    ? scope.body
    : undefined;
  for (const statementValue of Array.isArray(body) ? body : []) {
    const statement = node(statementValue);
    if (!statement) continue;
    if (statement.type === "VariableDeclaration") {
      for (const declarationValue of Array.isArray(statement.declarations)
        ? statement.declarations
        : []) {
        names.push(...patternNames(node(declarationValue)?.id));
      }
    } else if (statement.type === "FunctionDeclaration" || statement.type === "ClassDeclaration") {
      names.push(...patternNames(statement.id));
    }
  }
  return names;
}

function isShadowed(name: string, ancestors: readonly AstNode[]): boolean {
  return ancestors.some((ancestor) =>
    ancestor.type !== "Program"
    && (
      ancestor.type === "BlockStatement"
      || ancestor.type === "CatchClause"
      || ancestor.type === "FunctionDeclaration"
      || ancestor.type === "FunctionExpression"
      || ancestor.type === "ArrowFunctionExpression"
    )
    && directScopeDeclarations(ancestor).includes(name)
  );
}

export function transformApplicationSource(
  source: string,
  options: TransformOptions,
): TransformResult {
  const normalizedUrl = options.url.replaceAll("\\", "/");
  const normalizedCwd = process.cwd().replaceAll("\\", "/");
  const cwdUrl = pathToFileURL(process.cwd()).href.replace(/\/$/u, "");
  const stableUrl = normalizedUrl
    .replace(cwdUrl, "<cwd>")
    .replace(normalizedCwd, "<cwd>");
  if (
    normalizedUrl.includes("/node_modules/")
    || normalizedUrl.startsWith("node:")
    || !source.includes(options.dependency)
  ) {
    return { source, transformed: false, issues: [] };
  }

  let root: AstNode;
  try {
    root = parse(source, {
      ecmaVersion: "latest",
      sourceType: options.format === "module" ? "module" : "script",
      allowHashBang: true,
      allowReturnOutsideFunction: options.format === "commonjs",
      locations: true,
    }) as unknown as AstNode;
  } catch {
    return {
      source,
      transformed: false,
      issues: [
        issue(
          "PT_UNSUPPORTED_PARSE",
          `cannot parse ${options.format} application module for transparent instrumentation`,
        ),
      ],
    };
  }

  const bindings = new Map<string, Binding>();
  const issues: TransformIssue[] = [];

  walk(root, (current) => {
    if (current.type === "ImportDeclaration") {
      const specifier = literalString(current.source);
      if (!isDependencySpecifier(specifier, options.dependency) || specifier === undefined) return;
      const prefix = subpathPrefix(specifier, options.dependency);
      const specifiers = Array.isArray(current.specifiers) ? current.specifiers : [];
      for (const rawSpecifier of specifiers) {
        const importSpecifier = node(rawSpecifier);
        const local = nameOf(importSpecifier?.local);
        if (!importSpecifier || !local) continue;
        if (importSpecifier.type === "ImportDefaultSpecifier") {
          bindings.set(local, {
            kind: "direct",
            path: joinPath(prefix, "default"),
            moduleKind: "esm",
          });
        } else if (importSpecifier.type === "ImportNamespaceSpecifier") {
          bindings.set(local, { kind: "namespace", path: prefix, moduleKind: "esm" });
        } else if (importSpecifier.type === "ImportSpecifier") {
          const imported = nameOf(importSpecifier.imported) ?? literalString(importSpecifier.imported);
          if (imported) {
            bindings.set(local, {
              kind: "direct",
              path: joinPath(prefix, imported),
              moduleKind: "esm",
            });
          }
        }
      }
    }

    if (current.type === "ExportNamedDeclaration" || current.type === "ExportAllDeclaration") {
      if (isDependencySpecifier(literalString(current.source), options.dependency)) {
        issues.push(issue(
          "PT_UNSUPPORTED_REEXPORT",
          "dependency re-exports cannot be attributed transparently",
        ));
      }
    }

    if (current.type === "ImportExpression") {
      if (isDependencySpecifier(literalString(current.source), options.dependency)) {
        issues.push(issue(
          "PT_UNSUPPORTED_DYNAMIC_IMPORT",
          "dynamic dependency imports are not supported",
        ));
      }
    }

    if (current.type !== "VariableDeclarator") return;
    const directRequire = isRequireCall(current.init, options.dependency);
    if (directRequire) {
      const identifier = nameOf(current.id);
      if (identifier) {
        bindings.set(identifier, {
          kind: "commonjs",
          path: directRequire.prefix,
          moduleKind: "commonjs",
        });
        return;
      }
      const pattern = node(current.id);
      if (pattern?.type === "ObjectPattern") {
        const properties = Array.isArray(pattern.properties) ? pattern.properties : [];
        for (const rawProperty of properties) {
          const property = node(rawProperty);
          if (property?.type !== "Property" || property.computed === true) {
            issues.push(issue(
              "PT_UNSUPPORTED_REQUIRE_PATTERN",
              "computed or rest dependency destructuring is not supported",
            ));
            continue;
          }
          const imported = nameOf(property.key) ?? literalString(property.key);
          const local = nameOf(property.value);
          if (imported && local) {
            bindings.set(local, {
              kind: "direct",
              path: joinPath(directRequire.prefix, imported),
              moduleKind: "commonjs",
            });
          }
        }
      }
      return;
    }

    const initializer = node(current.init);
    if (initializer?.type === "MemberExpression") {
      const required = isRequireCall(initializer.object, options.dependency);
      const local = nameOf(current.id);
      const member = staticMemberName(initializer);
      if (required && local && member) {
        bindings.set(local, {
          kind: "direct",
          path: joinPath(required.prefix, member),
          moduleKind: "commonjs",
        });
      }
    }
  });

  const replacements: Replacement[] = [];

  walkWithAncestors(root, [], (current, ancestors) => {
    if (current.type !== "AssignmentExpression" && current.type !== "UpdateExpression") {
      return;
    }
    const assigned = node(current.left ?? current.argument);
    const assignedRoot = rootIdentifier(assigned);
    if (
      assignedRoot
      && bindings.has(assignedRoot)
      && !isShadowed(assignedRoot, ancestors)
    ) {
      issues.push(issue(
        "PT_UNSUPPORTED_REASSIGNMENT",
        "reassigned dependency bindings cannot be attributed transparently",
      ));
    }
  });

  walkWithAncestors(root, [], (current, ancestors) => {
    if (current.type === "NewExpression" || current.type === "TaggedTemplateExpression") {
      const callee = node(current.callee ?? current.tag);
      const bindingName = rootIdentifier(callee);
      if (bindingName && bindings.has(bindingName)) {
        issues.push(issue(
          current.type === "NewExpression"
            ? "PT_UNSUPPORTED_CONSTRUCTOR"
            : "PT_UNSUPPORTED_TAGGED_TEMPLATE",
          "dependency constructors and tagged templates are not supported",
        ));
      }
      return;
    }

    if (current.type !== "CallExpression") return;
    const callee = node(current.callee);
    if (!callee) return;
    const rootName = rootIdentifier(callee);
    if (!rootName || !bindings.has(rootName)) return;
    if (isShadowed(rootName, ancestors)) return;

    if (current.optional === true || callee.type === "ChainExpression" || callee.optional === true) {
      issues.push(issue(
        "PT_UNSUPPORTED_OPTIONAL_CALL",
        "optional dependency calls are not supported",
      ));
      return;
    }

    const argumentsValue = (Array.isArray(current.arguments) ? current.arguments : [])
      .map((argument) => node(argument))
      .filter((argument): argument is AstNode => argument !== undefined);
    const argumentStart = argumentsValue[0]?.start;
    const argumentEnd = argumentsValue.at(-1)?.end;
    const renderArguments = (render: (start: number, end: number) => string): string =>
      argumentStart === undefined || argumentEnd === undefined
        ? ""
        : render(argumentStart, argumentEnd);
    const binding = bindings.get(rootName);
    if (!binding) return;
    const location = current.loc?.start;
    const callSite = location
      ? `${stableUrl}:${location.line}:${location.column + 1}`
      : `${stableUrl}:offset-${current.start}`;

    if (callee.type === "Identifier") {
      if (binding.kind === "namespace") {
        issues.push(issue(
          "PT_UNSUPPORTED_NAMESPACE_CALL",
          "ES module namespace objects cannot be called",
        ));
        return;
      }
      const exportPath = binding.kind === "commonjs"
        ? joinPath(binding.path, "default")
        : binding.path;
      replacements.push({
        start: current.start,
        end: current.end,
        make: (render) =>
          `${RUNTIME}.invoke(${JSON.stringify(options.dependency)},${JSON.stringify(exportPath)},${rootName},void 0,[${renderArguments(render)}],${JSON.stringify(callSite)},${JSON.stringify(binding.moduleKind)},"none")`,
      });
      return;
    }

    if (callee.type !== "MemberExpression") return;
    const receiver = node(callee.object);
    if (receiver?.type !== "Identifier" || nameOf(receiver) !== rootName) {
      issues.push(issue(
        "PT_UNSUPPORTED_DEEP_MEMBER",
        "nested dependency member calls need an explicit supported export binding",
      ));
      return;
    }
    const member = staticMemberName(callee);
    if (!member) {
      issues.push(issue(
        "PT_UNSUPPORTED_COMPUTED_MEMBER",
        "computed dependency member calls are not supported",
      ));
      return;
    }
    if (
      binding.kind === "direct"
      && (member === "call" || member === "apply" || member === "bind")
    ) {
      issues.push(issue(
        "PT_UNSUPPORTED_INDIRECT_CALL",
        "call, apply, and bind require an explicit wrapper and are not supported",
      ));
      return;
    }
    const exportPath = joinPath(binding.path, member);
    replacements.push({
      start: current.start,
      end: current.end,
      make: (render) =>
        `${RUNTIME}.invoke(${JSON.stringify(options.dependency)},${JSON.stringify(exportPath)},${render(callee.start, callee.end)},${rootName},[${renderArguments(render)}],${JSON.stringify(callSite)},${JSON.stringify(binding.moduleKind)},"parent")`,
    });
  });

  if (issues.length > 0) {
    const unique = [...new Map(issues.map((item) => [item.code, item])).values()]
      .sort((left, right) => left.code.localeCompare(right.code));
    return { source, transformed: false, issues: unique };
  }
  if (replacements.length === 0) return { source, transformed: false, issues: [] };

  const render = (start: number, end: number): string => {
    const contained = replacements
      .filter((replacement) => replacement.start >= start && replacement.end <= end)
      .filter((replacement, _index, all) =>
        !all.some((other) =>
          other !== replacement
          && other.start <= replacement.start
          && other.end >= replacement.end
          && (other.start < replacement.start || other.end > replacement.end),
        ),
      )
      .sort((left, right) => left.start - right.start);
    let position = start;
    let result = "";
    for (const replacement of contained) {
      result += source.slice(position, replacement.start);
      result += replacement.make(render);
      position = replacement.end;
    }
    return result + source.slice(position, end);
  };

  return { source: render(0, source.length), transformed: true, issues: [] };
}
