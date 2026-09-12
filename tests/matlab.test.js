import assert from 'node:assert/strict';
import test from 'node:test';

import { tokenize, LexerError } from '../js/matlab/lexer.js';
import { parse, ParserError } from '../js/matlab/parser.js';
import { evaluate, EvaluationError } from '../js/matlab/evaluator.js';

function parseSource(source) {
  return parse(tokenize(source));
}

function evaluateSource(source) {
  return evaluate(parseSource(source));
}

function variable(source, name) {
  return evaluateSource(source).variables.get(name);
}

function matrixRows(value) {
  assert.equal(value.kind, 'matrix');
  return value.rows;
}

function assertClose(actual, expected, tolerance = 1e-10) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} is not close to ${expected}`);
}

function assertRowsClose(actual, expected, tolerance = 1e-10) {
  const actualRows = matrixRows(actual);
  assert.equal(actualRows.length, expected.length);

  actualRows.forEach((row, rowIndex) => {
    assert.equal(row.length, expected[rowIndex].length);
    row.forEach((value, columnIndex) => {
      assertClose(value, expected[rowIndex][columnIndex], tolerance);
    });
  });
}

function assertThrows(errorType, callback, message) {
  assert.throws(callback, (error) => {
    assert.ok(error instanceof errorType);
    if (message) {
      assert.match(error.message, message);
    }
    return true;
  });
}

test('lexer recognizes numbers, names, strings, operators, and punctuation', () => {
  const tokens = tokenize("x = -12.5e+2 + sin(x).^2; text = 'it''s';");

  assert.deepEqual(
    tokens.slice(0, -1).map(({ type, value }) => ({ type, value })),
    [
      { type: 'name', value: 'x' },
      { type: 'operator', value: '=' },
      { type: 'operator', value: '-' },
      { type: 'number', value: 1250 },
      { type: 'operator', value: '+' },
      { type: 'name', value: 'sin' },
      { type: 'operator', value: '(' },
      { type: 'name', value: 'x' },
      { type: 'operator', value: ')' },
      { type: 'operator', value: '.^' },
      { type: 'number', value: 2 },
      { type: 'operator', value: ';' },
      { type: 'name', value: 'text' },
      { type: 'operator', value: '=' },
      { type: 'string', value: "it's" },
      { type: 'operator', value: ';' }
    ]
  );

  assert.equal(tokens.at(-1).type, 'eof');
});

test('lexer recognizes all supported operators', () => {
  const values = tokenize('+ - * / ^ .* ./ .^ = ( ) [ ] , : ;')
    .filter((token) => token.type !== 'eof')
    .map((token) => token.value);

  assert.deepEqual(values, ['+', '-', '*', '/', '^', '.*', './', '.^', '=', '(', ')', '[', ']', ',', ':', ';']);
});

test('lexer skips comments and emits newline tokens', () => {
  const tokens = tokenize('% ignored comment\nx = 1;\n\n% another comment\ny = 2;');
  const newlines = tokens.filter((token) => token.type === 'newline');
  const names = tokens.filter((token) => token.type === 'name').map((token) => token.value);

  assert.equal(newlines.length, 4);
  assert.deepEqual(names, ['x', 'y']);
});

test('lexer counts LF, CRLF, and CR line endings', () => {
  for (const source of ['x = 1;\ny = 2;', 'x = 1;\r\ny = 2;', 'x = 1;\ry = 2;']) {
    const tokens = tokenize(source);
    const yToken = tokens.find((token) => token.type === 'name' && token.value === 'y');

    assert.equal(yToken.line, 2);
    assert.equal(yToken.column, 1);
  }
});

test('lexer reports unexpected characters with line and column', () => {
  assertThrows(LexerError, () => tokenize('x = 1;\ny = @'), /line 2, column 5/);
});

test('lexer reports unterminated strings with their starting position', () => {
  assertThrows(LexerError, () => tokenize("x = 'unfinished"), /Unterminated string at line 1, column 5/);
});

test('lexer rejects incomplete scientific notation', () => {
  assertThrows(LexerError, () => tokenize('x = 2e+'), /Expected a digit after the exponent/);
});

test('parser creates assignments and respects arithmetic precedence', () => {
  const program = parseSource('result = 1 + 2 * 3 ^ 2;');
  const assignment = program.statements[0];

  assert.equal(program.type, 'Program');
  assert.equal(assignment.type, 'Assignment');
  assert.equal(assignment.name, 'result');
  assert.equal(assignment.suppressed, true);
  assert.equal(assignment.value.type, 'BinaryExpression');
  assert.equal(assignment.value.operator, '+');
  assert.equal(assignment.value.right.operator, '*');
  assert.equal(assignment.value.right.right.operator, '^');
});

test('parser handles unary expressions and parentheses', () => {
  const program = parseSource('result = -(2 + 3);');
  const expression = program.statements[0].value;

  assert.equal(expression.type, 'UnaryExpression');
  assert.equal(expression.operator, '-');
  assert.equal(expression.value.type, 'BinaryExpression');
  assert.equal(expression.value.operator, '+');
});

test('parser handles function calls and comma-separated arguments', () => {
  const program = parseSource("x = linspace(0, 2*pi, 10);");
  const call = program.statements[0].value;

  assert.equal(call.type, 'CallExpression');
  assert.equal(call.callee.value, 'linspace');
  assert.equal(call.arguments.length, 3);
});

test('parser handles one-part and three-part ranges', () => {
  const program = parseSource('a = 1:5; b = 0:0.5:2;');
  const firstRange = program.statements[0].value;
  const secondRange = program.statements[1].value;

  assert.equal(firstRange.type, 'RangeExpression');
  assert.equal(firstRange.step, null);
  assert.equal(secondRange.step.type, 'NumberLiteral');
  assert.equal(secondRange.stop.value, 2);
});

test('parser handles row vectors, column vectors, and matrices', () => {
  const program = parseSource('row = [1 2, 3]; column = [1; 2; 3]; matrix = [1 2; 3 4];');

  assert.equal(program.statements[0].value.rows.length, 1);
  assert.equal(program.statements[0].value.rows[0].length, 3);
  assert.equal(program.statements[1].value.rows.length, 3);
  assert.equal(program.statements[2].value.rows.length, 2);
  assert.equal(program.statements[2].value.rows[1].length, 2);
});

test('parser handles plotting functions and commands', () => {
  const program = parseSource("plot(x, y); title('Sine'); xlabel('x'); ylabel('y'); grid on; hold off;");

  assert.equal(program.statements[0].expression.callee.value, 'plot');
  assert.equal(program.statements[1].expression.callee.value, 'title');
  assert.equal(program.statements[2].expression.callee.value, 'xlabel');
  assert.equal(program.statements[3].expression.callee.value, 'ylabel');
  assert.equal(program.statements[4].type, 'Command');
  assert.equal(program.statements[4].name, 'grid');
  assert.deepEqual(program.statements[4].arguments, ['on']);
  assert.equal(program.statements[5].name, 'hold');
});

test('parser allows blank lines, comments, and semicolon-terminated statements', () => {
  const program = parseSource('\n% comment\n x = 1;\n\ny = 2\n');

  assert.equal(program.statements.length, 2);
  assert.equal(program.statements[0].suppressed, true);
  assert.equal(program.statements[1].suppressed, false);
});

test('parser reports missing statement separators', () => {
  assertThrows(ParserError, () => parseSource('x = 1 y = 2'), /Expected a semicolon or newline/);
});

test('parser reports missing closing delimiters', () => {
  assertThrows(ParserError, () => parseSource('x = sin(1;'), /Expected '\)' after function arguments/);
  assertThrows(ParserError, () => parseSource('x = [1 2;'), /Expected '\]' after matrix/);
});

test('evaluator calculates scalar arithmetic and constants', () => {
  assert.equal(variable('x = 1 + 2 * 3;', 'x'), 7);
  assert.equal(variable('x = 2^3;', 'x'), 8);
  assertClose(variable('x = pi;', 'x'), Math.PI);
  assertClose(variable('x = 2*pi;', 'x'), 2 * Math.PI);
  assert.equal(variable('x = -(2 + 3);', 'x'), -5);
});

test('evaluator calculates ranges with ascending and descending steps', () => {
  assertRowsClose(variable('x = 1:5;', 'x'), [[1, 2, 3, 4, 5]]);
  assertRowsClose(variable('x = 0:0.5:1;', 'x'), [[0, 0.5, 1]]);
  assertRowsClose(variable('x = 5:-2:1;', 'x'), [[5, 3, 1]]);
});

test('evaluator creates row vectors, column vectors, and matrices', () => {
  assertRowsClose(variable('x = [1 2 3];', 'x'), [[1, 2, 3]]);
  assertRowsClose(variable('x = [1; 2; 3];', 'x'), [[1], [2], [3]]);
  assertRowsClose(variable('x = [1 2; 3 4];', 'x'), [[1, 2], [3, 4]]);
});

test('evaluator applies element-wise arithmetic to vectors', () => {
  assertRowsClose(variable('x = [1 2 3] + 1;', 'x'), [[2, 3, 4]]);
  assertRowsClose(variable('x = [1 2 3] .* [2 3 4];', 'x'), [[2, 6, 12]]);
  assertRowsClose(variable('x = [2 4 6] ./ 2;', 'x'), [[1, 2, 3]]);
  assertRowsClose(variable('x = [1 2 3] .^ 2;', 'x'), [[1, 4, 9]]);
});

test('evaluator performs matrix multiplication', () => {
  const value = variable('A = [1 2; 3 4]; B = A * A;', 'B');
  assertRowsClose(value, [[7, 10], [15, 22]]);
});

test('evaluator provides mathematical built-ins', () => {
  assertRowsClose(variable('x = sin([0 pi/2 pi]);', 'x'), [[0, 1, 0]], 1e-9);
  assertRowsClose(variable('x = cos([0 pi]);', 'x'), [[1, -1]], 1e-9);
  assertRowsClose(variable('x = [abs(-2) sqrt(9) exp(0) log(1)];', 'x'), [[2, 3, 1, 0]]);
  assertRowsClose(variable('x = [floor(1.8) ceil(1.2) round(1.5)];', 'x'), [[1, 2, 2]]);
});

test('evaluator provides linspace', () => {
  assertRowsClose(variable('x = linspace(0, 1, 5);', 'x'), [[0, 0.25, 0.5, 0.75, 1]]);
  assertRowsClose(variable('x = linspace(4, 9, 1);', 'x'), [[4]]);
  assertRowsClose(variable('x = linspace(4, 9, 0);', 'x'), [[]]);
});

test('evaluator provides zeros and ones', () => {
  assertRowsClose(variable('x = zeros(2, 3);', 'x'), [[0, 0, 0], [0, 0, 0]]);
  assertRowsClose(variable('x = ones(2);', 'x'), [[1, 1], [1, 1]]);
});

test('evaluator provides size, length, sum, min, and max', () => {
  const result = evaluateSource('A = [1 2; 3 4]; v = [1 2 3 4]; s = size(A); l = length(A); total = sum(v); low = min(v); high = max(v);');

  assertRowsClose(result.variables.get('s'), [[2, 2]]);
  assert.equal(result.variables.get('l'), 2);
  assert.equal(result.variables.get('total'), 10);
  assert.equal(result.variables.get('low'), 1);
  assert.equal(result.variables.get('high'), 4);
});

test('evaluator records plot(y) with one-based x values', () => {
  const result = evaluateSource('y = [4 5 6]; plot(y);');

  assert.deepEqual(result.plots, [{ x: [1, 2, 3], y: [4, 5, 6] }]);
});

test('evaluator records plot(x, y) and plot settings', () => {
  const result = evaluateSource("x = [0 1 2]; y = [1 3 5]; plot(x, y); title('Line'); xlabel('time'); ylabel('value'); grid on; hold on;");

  assert.deepEqual(result.plots, [{ x: [0, 1, 2], y: [1, 3, 5] }]);
  assert.deepEqual(result.settings, {
    title: 'Line',
    xLabel: 'time',
    yLabel: 'value',
    grid: true,
    hold: true
  });
});

test('evaluator accepts grid off and hold off', () => {
  const result = evaluateSource('grid off; hold off;');

  assert.equal(result.settings.grid, false);
  assert.equal(result.settings.hold, false);
});

test('evaluator reports undefined variables', () => {
  assertThrows(EvaluationError, () => evaluateSource('x = missing + 1;'), /Undefined variable 'missing'/);
});

test('evaluator reports unknown functions', () => {
  assertThrows(EvaluationError, () => evaluateSource('x = unknown(1);'), /Unknown function 'unknown'/);
});

test('evaluator reports invalid ranges and dimensions', () => {
  assertThrows(EvaluationError, () => evaluateSource('x = 1:0:3;'), /Range step cannot be zero/);
  assertThrows(EvaluationError, () => evaluateSource('x = linspace(0, 1, 2.5);'), /linspace count must be a non-negative integer/);
  assertThrows(EvaluationError, () => evaluateSource('x = zeros(-1);'), /Matrix dimensions must be non-negative integers/);
});

test('evaluator reports invalid plot arguments', () => {
  assertThrows(EvaluationError, () => evaluateSource('plot([1 2], [3]);'), /same length/);
  assertThrows(EvaluationError, () => evaluateSource('plot([1 2; 3 4]);'), /plot y-values must be a vector/);
});

test('evaluator reports incompatible matrix operations', () => {
  assertThrows(EvaluationError, () => evaluateSource('x = [1 2] + [1; 2];'), /Matrix dimensions do not agree/);
  assertThrows(EvaluationError, () => evaluateSource('x = [1 2] * [1 2];'), /Matrix dimensions do not agree/);
});
