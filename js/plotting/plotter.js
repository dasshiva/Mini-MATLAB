export function renderPlots(container, evaluation) {
  if (typeof Plotly === 'undefined') {
    throw new Error('Plotly.js is missing. Add js/vendor/plotly.min.js to the project.');
  }

  container.classList.add('plot-output');
  Plotly.purge(container);
  container.replaceChildren();

  if (evaluation.plots.length === 0) {
    container.textContent = 'Code ran successfully, but no plot was created.';
    return;
  }

  const traces = evaluation.plots.map((plot, index) => ({
    x: plot.x,
    y: plot.y,
    type: 'scatter',
    mode: 'lines',
    name: `Plot ${index + 1}`
  }));

  const layout = {
    title: evaluation.settings.title,
    xaxis: {
      title: evaluation.settings.xLabel,
      showgrid: evaluation.settings.grid
    },
    yaxis: {
      title: evaluation.settings.yLabel,
      showgrid: evaluation.settings.grid
    },
    margin: {
      top: 50,
      right: 20,
      bottom: 60,
      left: 60
    },
    paper_bgcolor: '#ffffff',
    plot_bgcolor: '#ffffff',
    showlegend: evaluation.plots.length > 1
  };

  const options = {
    responsive: true,
    displaylogo: false
  };

  Plotly.newPlot(container, traces, layout, options);
}
