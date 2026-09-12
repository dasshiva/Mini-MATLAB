export class EvaluationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EvaluationError';
  }
}

export function evaluate(program) {
  const variables = new Map();
  const plots = [];
  const settings = {
    title: '',
    xLabel: '',
    yLabel: '',
    grid: false,
    hold: false
  };

  variables.set('pi', Math.PI);
  variables.set('e', Math.E);

  for (const statement of program.statements) {
    evaluateStatement(statement);
  }

  return {
    variables,
    plots,
    settings
  };

  function evaluateStatement(statement) {
    if (statement.type === 'Assignment') {
      variables.set(statement.name, evaluateNode(statement.value));
      return;
    }

    if (statement.type === 'ExpressionStatement') {
      evaluateNode(statement.expression);
      return;
    }

    if (statement.type === 'Command') {
      evaluateCommand(statement);
      return;
    }

    throw new EvaluationError(`Unsupported statement '${statement.type}'`);
  }

  function evaluateCommand(statement) {
    if (statement.name === 'grid') {
      settings.grid = statement.arguments[0] === 'on';
      return;
    }

    if (statement.name === 'hold') {
      settings.hold = statement.arguments[0] === 'on';
      return;
    }

    throw new EvaluationError(`Unsupported command '${statement.name}'`);
  }

  function evaluateNode(node) {
    switch (node.type) {
      case 'NumberLiteral':
      case 'StringLiteral':
        return node.value;
      case 'Name':
        return getVariable(node.value);
      case 'UnaryExpression':
        return applyUnary(node.operator, evaluateNode(node.value));
      case 'BinaryExpression':
        return applyBinary(
          node.operator,
          evaluateNode(node.left),
          evaluateNode(node.right)
        );
      case 'RangeExpression':
        return evaluateRange(node);
      case 'MatrixLiteral':
        return evaluateMatrix(node);
      case 'CallExpression':
        return evaluateCall(node);
      default:
        throw new EvaluationError(`Unsupported expression '${node.type}'`);
    }
  }

  function evaluateRange(node) {
    const start = requireScalar(evaluateNode(node.start), 'Range start');
    const stop = requireScalar(evaluateNode(node.stop), 'Range stop');
    const step = node.step === null
      ? (start <= stop ? 1 : -1)
      : requireScalar(evaluateNode(node.step), 'Range step');

    if (step === 0) {
      throw new EvaluationError('Range step cannot be zero');
    }

    const values = [];
    const movingForward = step > 0;

    for (let value = start; movingForward ? value <= stop : value >= stop; value += step) {
      values.push(value);

      if (values.length > 100000) {
        throw new EvaluationError('Range contains too many values');
      }
    }

    return vector(values);
  }

  function evaluateMatrix(node) {
    const rows = node.rows.map((row) => row.map((value) => {
      const evaluated = evaluateNode(value);

      if (isMatrix(evaluated)) {
        throw new EvaluationError('Nested matrices are not supported');
      }

      return evaluated;
    }));

    const columnCount = rows[0]?.length || 0;

    if (rows.some((row) => row.length !== columnCount)) {
      throw new EvaluationError('All matrix rows must have the same length');
    }

    return matrix(rows);
  }

  function evaluateCall(node) {
    if (node.callee.type !== 'Name') {
      throw new EvaluationError('Only named functions are supported');
    }

    const name = node.callee.value;
    const argumentsList = node.arguments.map(evaluateNode);

    if (name === 'plot') {
      recordPlot(argumentsList);
      return null;
    }

    if (name === 'title' || name === 'xlabel' || name === 'ylabel') {
      if (argumentsList.length !== 1 || typeof argumentsList[0] !== 'string') {
        throw new EvaluationError(`${name} expects one string argument`);
      }

      settings[name === 'title' ? 'title' : name === 'xlabel' ? 'xLabel' : 'yLabel'] = argumentsList[0];
      return null;
    }

    return evaluateBuiltin(name, argumentsList);
  }

  function recordPlot(argumentsList) {
    if (argumentsList.length !== 1 && argumentsList.length !== 2) {
      throw new EvaluationError('plot expects one or two arguments');
    }

    const yValues = getVector(argumentsList[argumentsList.length - 1], 'plot y-values');
    const xValues = argumentsList.length === 2
      ? getVector(argumentsList[0], 'plot x-values')
      : yValues.map((value, index) => index + 1);

    if (xValues.length !== yValues.length) {
      throw new EvaluationError('plot x- and y-values must have the same length');
    }

    plots.push({
      x: xValues,
      y: yValues
    });
  }

  function evaluateBuiltin(name, argumentsList) {
    const functions = {
      sin: Math.sin,
      cos: Math.cos,
      tan: Math.tan,
      exp: Math.exp,
      log: Math.log,
      sqrt: Math.sqrt,
      abs: Math.abs,
      floor: Math.floor,
      ceil: Math.ceil,
      round: Math.round
    };

    if (functions[name]) {
      requireArgumentCount(name, argumentsList, 1);
      return mapValue(argumentsList[0], functions[name]);
    }

    if (name === 'linspace') {
      requireArgumentCount(name, argumentsList, 3);
      return createLinspace(
        requireScalar(argumentsList[0], 'linspace start'),
        requireScalar(argumentsList[1], 'linspace stop'),
        requireScalar(argumentsList[2], 'linspace count')
      );
    }

    if (name === 'zeros' || name === 'ones') {
      return createFilledMatrix(name === 'zeros' ? 0 : 1, argumentsList);
    }

    if (name === 'length') {
      requireArgumentCount(name, argumentsList, 1);
      return Math.max(...matrixShape(argumentsList[0]));
    }

    if (name === 'size') {
      requireArgumentCount(name, argumentsList, 1);
      return vector(matrixShape(argumentsList[0]));
    }

    if (name === 'sum' || name === 'min' || name === 'max') {
      requireArgumentCount(name, argumentsList, 1);
      const values = getVector(argumentsList[0], name);

      if (name === 'sum') {
        return values.reduce((total, value) => total + value, 0);
      }

      return name === 'min' ? Math.min(...values) : Math.max(...values);
    }

    throw new EvaluationError(`Unknown function '${name}'`);
  }

  function applyUnary(operator, value) {
    if (operator === '+') {
      return value;
    }

    return mapValue(value, (number) => -number);
  }

  function applyBinary(operator, left, right) {
    if (operator === '+' || operator === '-') {
      return combineValues(left, right, (a, b) => operator === '+' ? a + b : a - b);
    }

    if (operator === '.*' || operator === './' || operator === '.^') {
      const operation = operator === '.*'
        ? (a, b) => a * b
        : operator === './'
          ? (a, b) => a / b
          : (a, b) => a ** b;
      return combineValues(left, right, operation);
    }

    if (operator === '*') {
      return multiplyValues(left, right);
    }

    if (operator === '/') {
      if (isMatrix(right)) {
        throw new EvaluationError('Matrix right division is not supported');
      }

      return mapValue(left, (value) => value / requireScalar(right, 'Division denominator'));
    }

    if (operator === '^') {
      return scalarOperation(left, right, (a, b) => a ** b);
    }

    throw new EvaluationError(`Unsupported operator '${operator}'`);
  }

  function multiplyValues(left, right) {
    if (!isMatrix(left) && !isMatrix(right)) {
      return left * right;
    }

    if (!isMatrix(left)) {
      return mapValue(right, (value) => left * value);
    }

    if (!isMatrix(right)) {
      return mapValue(left, (value) => value * right);
    }

    if (left.rows[0].length !== right.rows.length) {
      throw new EvaluationError('Matrix dimensions do not agree for multiplication');
    }

    const rows = left.rows.map((row) => right.rows[0].map((_, column) => (
      row.reduce((total, value, index) => total + value * right.rows[index][column], 0)
    )));

    return matrix(rows);
  }

  function combineValues(left, right, operation) {
    if (!isMatrix(left) && !isMatrix(right)) {
      return operation(left, right);
    }

    if (!isMatrix(left)) {
      return mapValue(right, (value) => operation(left, value));
    }

    if (!isMatrix(right)) {
      return mapValue(left, (value) => operation(value, right));
    }

    if (!sameShape(left, right)) {
      throw new EvaluationError('Matrix dimensions do not agree');
    }

    return matrix(left.rows.map((row, rowIndex) => row.map((value, columnIndex) => (
      operation(value, right.rows[rowIndex][columnIndex])
    ))));
  }

  function scalarOperation(left, right, operation) {
    if (isMatrix(left) || isMatrix(right)) {
      throw new EvaluationError('This operator requires scalar values');
    }

    return operation(left, right);
  }

  function mapValue(value, operation) {
    if (!isMatrix(value)) {
      return operation(requireScalar(value, 'Function argument'));
    }

    return matrix(value.rows.map((row) => row.map(operation)));
  }

  function createLinspace(start, stop, count) {
    if (!Number.isInteger(count) || count < 0) {
      throw new EvaluationError('linspace count must be a non-negative integer');
    }

    if (count === 0) {
      return vector([]);
    }

    if (count === 1) {
      return vector([start]);
    }

    const step = (stop - start) / (count - 1);
    return vector(Array.from({ length: count }, (_, index) => start + index * step));
  }

  function createFilledMatrix(value, argumentsList) {
    if (argumentsList.length !== 1 && argumentsList.length !== 2) {
      throw new EvaluationError('zeros and ones expect one or two dimensions');
    }

    const rows = requireDimension(argumentsList[0]);
    const columns = argumentsList.length === 2 ? requireDimension(argumentsList[1]) : rows;
    return matrix(Array.from({ length: rows }, () => Array(columns).fill(value)));
  }

  function getVariable(name) {
    if (!variables.has(name)) {
      throw new EvaluationError(`Undefined variable '${name}'`);
    }

    return variables.get(name);
  }
}

function matrix(rows) {
  return { kind: 'matrix', rows };
}

function vector(values) {
  return matrix([values]);
}

function isMatrix(value) {
  return value !== null && typeof value === 'object' && value.kind === 'matrix';
}

function sameShape(left, right) {
  return left.rows.length === right.rows.length &&
    left.rows[0].length === right.rows[0].length;
}

function matrixShape(value) {
  if (!isMatrix(value)) {
    return [1, 1];
  }

  return [value.rows.length, value.rows[0]?.length || 0];
}

function getVector(value, label) {
  if (!isMatrix(value)) {
    return [requireScalar(value, label)];
  }

  if (value.rows.length !== 1 && value.rows[0].length !== 1) {
    throw new EvaluationError(`${label} must be a vector`);
  }

  return value.rows.length === 1 ? value.rows[0] : value.rows.map((row) => row[0]);
}

function requireScalar(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new EvaluationError(`${label} must be a finite number`);
  }

  return value;
}

function requireArgumentCount(name, argumentsList, count) {
  if (argumentsList.length !== count) {
    throw new EvaluationError(`${name} expects ${count} argument${count === 1 ? '' : 's'}`);
  }
}

function requireDimension(value) {
  const dimension = requireScalar(value, 'Matrix dimension');

  if (!Number.isInteger(dimension) || dimension < 0) {
    throw new EvaluationError('Matrix dimensions must be non-negative integers');
  }

  return dimension;
}
