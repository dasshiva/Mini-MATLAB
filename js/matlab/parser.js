export class ParserError extends Error {
  constructor(message, token) {
    super(`${message} at line ${token.line}, column ${token.column}`);
    this.name = 'ParserError';
    this.line = token.line;
    this.column = token.column;
  }
}

export function parse(tokens) {
  return new Parser(tokens).parseProgram();
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.position = 0;
  }

  parseProgram() {
    const statements = [];

    this.skipNewlines();

    while (!this.isAtEnd()) {
      const statement = this.parseStatement();
      let suppressed = false;

      if (this.matchValue(';')) {
        suppressed = true;

        while (this.matchValue(';')) {
          // Allow repeated semicolons between statements.
        }
      }

      statements.push({
        ...statement,
        suppressed
      });

      if (!suppressed && !this.isAtEnd() && !this.checkValue('\n')) {
        throw this.error('Expected a semicolon or newline');
      }

      this.skipNewlines();
    }

    return {
      type: 'Program',
      statements
    };
  }

  parseStatement() {
    if (this.checkType('name') && this.checkValue('=', 1)) {
      const name = this.advance();
      this.advance();

      return {
        type: 'Assignment',
        name: name.value,
        value: this.parseExpression()
      };
    }

    if (this.checkType('name') && this.isCommand(this.current().value)) {
      return this.parseCommand();
    }

    return {
      type: 'ExpressionStatement',
      expression: this.parseExpression()
    };
  }

  parseCommand() {
    const name = this.advance();
    const argumentsList = [];

    while (!this.isAtEnd() && !this.checkValue(';') && !this.checkValue('\n')) {
      if (!this.checkType('name') && !this.checkType('string')) {
        throw this.error('Expected a command argument');
      }

      argumentsList.push(this.advance().value);
    }

    if (argumentsList.length === 0) {
      throw this.error(`Expected an argument after '${name.value}'`);
    }

    return {
      type: 'Command',
      name: name.value,
      arguments: argumentsList
    };
  }

  parseExpression() {
    return this.parseRange();
  }

  parseRange() {
    const first = this.parseAddSubtract();

    if (!this.matchValue(':')) {
      return first;
    }

    const second = this.parseAddSubtract();

    if (this.matchValue(':')) {
      return {
        type: 'RangeExpression',
        start: first,
        step: second,
        stop: this.parseAddSubtract()
      };
    }

    return {
      type: 'RangeExpression',
      start: first,
      step: null,
      stop: second
    };
  }

  parseAddSubtract() {
    let expression = this.parseMultiplyDivide();

    while (this.matchValue('+', '-')) {
      const operator = this.previous().value;
      expression = {
        type: 'BinaryExpression',
        operator,
        left: expression,
        right: this.parseMultiplyDivide()
      };
    }

    return expression;
  }

  parseMultiplyDivide() {
    let expression = this.parsePower();

    while (this.matchValue('*', '/', '.*', './')) {
      const operator = this.previous().value;
      expression = {
        type: 'BinaryExpression',
        operator,
        left: expression,
        right: this.parsePower()
      };
    }

    return expression;
  }

  parsePower() {
    const left = this.parseUnary();

    if (this.matchValue('^', '.^')) {
      return {
        type: 'BinaryExpression',
        operator: this.previous().value,
        left,
        right: this.parsePower()
      };
    }

    return left;
  }

  parseUnary() {
    if (this.matchValue('+', '-')) {
      return {
        type: 'UnaryExpression',
        operator: this.previous().value,
        value: this.parseUnary()
      };
    }

    return this.parsePostfix();
  }

  parsePostfix() {
    let expression = this.parsePrimary();

    while (this.matchValue('(')) {
      const argumentsList = [];

      if (!this.checkValue(')')) {
        do {
          argumentsList.push(this.parseExpression());
        } while (this.matchValue(','));
      }

      this.consume(')', "Expected ')' after function arguments");
      expression = {
        type: 'CallExpression',
        callee: expression,
        arguments: argumentsList
      };
    }

    return expression;
  }

  parsePrimary() {
    if (this.matchType('number')) {
      return {
        type: 'NumberLiteral',
        value: this.previous().value
      };
    }

    if (this.matchType('string')) {
      return {
        type: 'StringLiteral',
        value: this.previous().value
      };
    }

    if (this.matchType('name')) {
      return {
        type: 'Name',
        value: this.previous().value
      };
    }

    if (this.matchValue('(')) {
      const expression = this.parseExpression();
      this.consume(')', "Expected ')' after expression");
      return expression;
    }

    if (this.matchValue('[')) {
      return this.parseMatrix();
    }

    throw this.error('Expected a number, name, string, or expression');
  }

  parseMatrix() {
    const rows = [];

    if (!this.checkValue(']')) {
      do {
        if (this.isAtEnd() || this.checkValue('\n')) {
          throw this.error("Expected ']' after matrix");
        }

        const row = [];

        while (!this.checkValue(';') && !this.checkValue(']')) {
          row.push(this.parseExpression());

          if (this.checkValue(',') || this.canStartExpression()) {
            this.matchValue(',');
            continue;
          }

          break;
        }

        if (row.length === 0) {
          throw this.error('Expected a matrix value');
        }

        rows.push(row);
      } while (this.matchValue(';'));
    }

    this.consume(']', "Expected ']' after matrix");

    return {
      type: 'MatrixLiteral',
      rows
    };
  }

  isCommand(name) {
    return name === 'grid' || name === 'hold';
  }

  canStartExpression() {
    return this.checkType('number') || this.checkType('name') ||
      this.checkType('string') || this.checkValue('(') ||
      this.checkValue('[') || this.checkValue('+') || this.checkValue('-');
  }

  skipNewlines() {
    while (this.matchValue('\n')) {
      // Skip blank lines.
    }
  }

  consume(value, message) {
    if (this.matchValue(value)) {
      return this.previous();
    }

    throw this.error(message);
  }

  matchType(type) {
    if (!this.checkType(type)) {
      return false;
    }

    this.advance();
    return true;
  }

  matchValue(...values) {
    for (const value of values) {
      if (this.checkValue(value)) {
        this.advance();
        return true;
      }
    }

    return false;
  }

  checkType(type, offset = 0) {
    return this.tokens[this.position + offset]?.type === type;
  }

  checkValue(value, offset = 0) {
    return this.tokens[this.position + offset]?.value === value;
  }

  advance() {
    if (!this.isAtEnd()) {
      this.position += 1;
    }

    return this.previous();
  }

  current() {
    return this.tokens[this.position];
  }

  previous() {
    return this.tokens[this.position - 1];
  }

  isAtEnd() {
    return this.checkType('eof');
  }

  error(message) {
    return new ParserError(message, this.current());
  }
}
