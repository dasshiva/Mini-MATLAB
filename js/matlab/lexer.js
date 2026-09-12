const twoCharacterOperators = ['.*', './', '.^'];
const oneCharacterOperators = ['+', '-', '*', '/', '^', '=', '(', ')', '[', ']', ',', ':', ';'];

export class LexerError extends Error {
  constructor(message, line, column) {
    super(`${message} at line ${line}, column ${column}`);
    this.name = 'LexerError';
    this.line = line;
    this.column = column;
  }
}

export function tokenize(source) {
  const tokens = [];
  let position = 0;
  let line = 1;
  let column = 1;

  while (position < source.length) {
    const character = source[position];

    if (character === ' ' || character === '\t') {
      advance();
      continue;
    }

    if (character === '\n' || character === '\r') {
      const newlineLength = character === '\r' && source[position + 1] === '\n' ? 2 : 1;
      tokens.push(token('newline', '\n', position, position + newlineLength, line, column));
      advance();
      continue;
    }

    if (character === '%') {
      skipComment();
      continue;
    }

    if (isDigit(character) || (character === '.' && isDigit(source[position + 1]))) {
      tokens.push(readNumber());
      continue;
    }

    if (isNameStart(character)) {
      tokens.push(readName());
      continue;
    }

    if (character === "'") {
      tokens.push(readString());
      continue;
    }

    const twoCharacterOperator = source.slice(position, position + 2);

    if (twoCharacterOperators.includes(twoCharacterOperator)) {
      tokens.push(readOperator(twoCharacterOperator, 2));
      continue;
    }

    if (oneCharacterOperators.includes(character)) {
      tokens.push(readOperator(character, 1));
      continue;
    }

    throw new LexerError(`Unexpected character '${character}'`, line, column);
  }

  tokens.push(token('eof', '', position, position, line, column));
  return tokens;

  function advance() {
    if (source[position] === '\r' && source[position + 1] === '\n') {
      position += 2;
      line += 1;
      column = 1;
      return;
    }

    if (source[position] === '\n' || source[position] === '\r') {
      position += 1;
      line += 1;
      column = 1;
      return;
    }

    column += 1;
    position += 1;
  }

  function skipComment() {
    while (position < source.length && source[position] !== '\n') {
      advance();
    }
  }

  function readNumber() {
    const start = position;
    const startLine = line;
    const startColumn = column;

    if (source[position] === '.') {
      advance();
    }

    while (isDigit(source[position])) {
      advance();
    }

    if (source[position] === '.') {
      advance();

      while (isDigit(source[position])) {
        advance();
      }
    }

    if (source[position] === 'e' || source[position] === 'E') {
      advance();

      if (source[position] === '+' || source[position] === '-') {
        advance();
      }

      if (!isDigit(source[position])) {
        throw new LexerError('Expected a digit after the exponent', line, column);
      }

      while (isDigit(source[position])) {
        advance();
      }
    }

    const value = source.slice(start, position);
    return token('number', Number(value), start, position, startLine, startColumn);
  }

  function readName() {
    const start = position;
    const startLine = line;
    const startColumn = column;

    while (isNamePart(source[position])) {
      advance();
    }

    return token('name', source.slice(start, position), start, position, startLine, startColumn);
  }

  function readString() {
    const start = position;
    const startLine = line;
    const startColumn = column;
    let value = '';

    advance();

    while (position < source.length) {
      if (source[position] === "'") {
        if (source[position + 1] === "'") {
          value += "'";
          advance();
          advance();
          continue;
        }

        advance();
        return token('string', value, start, position, startLine, startColumn);
      }

      if (source[position] === '\n') {
        throw new LexerError('Unterminated string', line, column);
      }

      value += source[position];
      advance();
    }

    throw new LexerError('Unterminated string', startLine, startColumn);
  }

  function readOperator(value, length) {
    const start = position;
    const startLine = line;
    const startColumn = column;

    for (let index = 0; index < length; index += 1) {
      advance();
    }

    return token('operator', value, start, position, startLine, startColumn);
  }

  function token(type, value, start, end, tokenLine, tokenColumn) {
    return {
      type,
      value,
      start,
      end,
      line: tokenLine,
      column: tokenColumn
    };
  }
}

function isDigit(character) {
  return character >= '0' && character <= '9';
}

function isNameStart(character) {
  return Boolean(character) && /[A-Za-z_]/.test(character);
}

function isNamePart(character) {
  return Boolean(character) && /[A-Za-z0-9_]/.test(character);
}
