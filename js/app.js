import { tokenize, LexerError } from './matlab/lexer.js';
import { parse, ParserError } from './matlab/parser.js';
import { evaluate, EvaluationError } from './matlab/evaluator.js';
import { renderPlots } from './plotting/plotter.js';

const editor = document.querySelector('#code-editor');
const graphOutput = document.querySelector('#graph-output');
const fileInput = document.querySelector('#file-input');

const createButton = document.querySelector('#new-button');
const openButton = document.querySelector('#open-button');
const saveButton = document.querySelector('#save-button');
const runButton = document.querySelector('#run-button');
const saveDialog = document.querySelector('#save-dialog');
const saveForm = document.querySelector('#save-form');
const filenameInput = document.querySelector('#filename-input');
const cancelSaveButton = document.querySelector('#cancel-save-button');

createButton.addEventListener('click', () => {
  editor.value = '';
  graphOutput.textContent = 'Run some code to get started';
});

openButton.addEventListener('click', () => {
  fileInput.click();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];

  if (!file) {
    return;
  }

  const reader = new FileReader();
  reader.addEventListener('load', () => {
    editor.value = reader.result;
    graphOutput.textContent = 'Run some code to get started';
  });
  reader.readAsText(file);
});

saveButton.addEventListener('click', () => {
  saveDialog.showModal();
  filenameInput.focus();
  filenameInput.select();
});

cancelSaveButton.addEventListener('click', () => {
  saveDialog.close();
});

saveForm.addEventListener('submit', (event) => {
  event.preventDefault();

  const filename = filenameInput.value.trim();

  if (!filename) {
    filenameInput.focus();
    return;
  }

  const file = new Blob([editor.value], { type: 'text/plain' });
  const downloadLink = document.createElement('a');

  downloadLink.href = URL.createObjectURL(file);
  downloadLink.download = filename;
  downloadLink.click();
  URL.revokeObjectURL(downloadLink.href);
  saveDialog.close();
});

runButton.addEventListener('click', () => {
  try {
    const tokens = tokenize(editor.value);
    const program = parse(tokens);
    const result = evaluate(program);
    renderPlots(graphOutput, result);
  } catch (error) {
    if (error instanceof LexerError || error instanceof ParserError || error instanceof EvaluationError) {
      graphOutput.textContent = error.message;
      return;
    }

    graphOutput.textContent = 'Unable to parse the code.';
    console.error(error);
  }
});
