import { builtinModules } from 'node:module';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbiddenPackages = new Set([
  'argon2',
  'drizzle-orm',
  'ioredis',
  'jose',
  'pg',
  'redis',
  'server-only',
]);
const forbiddenNextModules = new Set(['next/headers', 'next/server']);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/, '')));

function getModuleViolation(moduleName, sourceFilePath, frontendRoot) {
  if (moduleName.startsWith('@/')) {
    if (!/^@\/(frontend|shared)\//.test(moduleName)) {
      return `imports outside the frontend/shared boundary: ${moduleName}`;
    }
    return null;
  }

  if (moduleName.startsWith('.')) {
    const target = path.resolve(path.dirname(sourceFilePath), moduleName);
    const relativeTarget = path.relative(frontendRoot, target);
    if (relativeTarget === '..' || relativeTarget.startsWith(`..${path.sep}`) || path.isAbsolute(relativeTarget)) {
      return `imports outside the frontend/shared boundary: ${moduleName}`;
    }
    return null;
  }

  const normalizedName = moduleName.replace(/^node:/, '');
  if (builtins.has(normalizedName)) {
    return `imports Node.js built-in module: ${moduleName}`;
  }

  const packageName = normalizedName.startsWith('@')
    ? normalizedName.split('/').slice(0, 2).join('/')
    : normalizedName.split('/')[0];
  if (forbiddenPackages.has(packageName) || forbiddenNextModules.has(normalizedName)) {
    return `imports server-only dependency: ${moduleName}`;
  }

  return null;
}

function moduleSpecifiers(sourceFile) {
  const specifiers = [];

  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      if (ts.isStringLiteral(node.moduleSpecifier)) {
        specifiers.push(node.moduleSpecifier.text);
      }
    } else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && node.moduleReference.expression
      && ts.isStringLiteral(node.moduleReference.expression)) {
      specifiers.push(node.moduleReference.expression.text);
    } else if (ts.isCallExpression(node)
      && (node.expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      const argument = node.arguments[0];
      if (argument && ts.isStringLiteral(argument)) {
        specifiers.push(argument.text);
      } else {
        specifiers.push(null);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return specifiers;
}

async function sourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await sourceFiles(entryPath));
    } else if (/\.(?:[cm]?js|jsx|tsx?)$/.test(entry.name)) {
      files.push(entryPath);
    }
  }
  return files;
}

export async function findFrontendBoundaryViolations(frontendRoot) {
  const root = path.resolve(frontendRoot);
  const violations = [];

  for (const filePath of await sourceFiles(root)) {
    const contents = await readFile(filePath, 'utf8');
    const extension = path.extname(filePath);
    const scriptKind = extension === '.tsx'
      ? ts.ScriptKind.TSX
      : extension === '.jsx'
        ? ts.ScriptKind.JSX
        : extension === '.ts'
          ? ts.ScriptKind.TS
          : ts.ScriptKind.JS;
    const sourceFile = ts.createSourceFile(filePath, contents, ts.ScriptTarget.Latest, true, scriptKind);

    for (const moduleName of moduleSpecifiers(sourceFile)) {
      if (moduleName === null) {
        violations.push(`${path.relative(projectRoot, filePath)}: non-literal dynamic import or require`);
        continue;
      }

      const reason = getModuleViolation(moduleName, filePath, root);
      if (reason) {
        violations.push(`${path.relative(projectRoot, filePath)}: ${reason}`);
      }
    }
  }

  return violations;
}

async function main() {
  const frontendRoot = process.argv[2]
    ? path.resolve(process.argv[2])
    : path.join(projectRoot, 'src/frontend');
  const violations = await findFrontendBoundaryViolations(frontendRoot);

  if (violations.length > 0) {
    console.error('Frontend boundary violations found:');
    for (const violation of violations) console.error(`- ${violation}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Frontend import boundary passed: ${path.relative(projectRoot, frontendRoot)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
