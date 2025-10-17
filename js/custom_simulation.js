(function(){
  const $ = id => document.getElementById(id);
  const simulateBtn = $('simulateBtn');
  const chartOtherOutputs = $('chartOtherOutputs');
  const tableContainer = $('tableContainer');
  const summary = $('summary');
  const landUseContainer = $('landUseContainer');

  const landUses = []; 

  // Add land use entry dynamically
  $('addLandUseBtn').addEventListener('click', () => {
    const select = $('landUseType');
    const typeText = select.options[select.selectedIndex].text;
    const cValue = parseFloat(select.value);

    const entryDiv = document.createElement('div');
    entryDiv.classList.add('land-use-entry');

    const areaInput = document.createElement('input');
    areaInput.type = 'number';
    areaInput.min = '0';
    areaInput.step = '1';
    areaInput.placeholder = 'Area (m²)';

    const label = document.createElement('span');
    label.textContent = typeText;

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'X';
    removeBtn.classList.add('remove-btn');
    removeBtn.addEventListener('click', () => {
      landUseContainer.removeChild(entryDiv);
      const index = landUses.findIndex(lu => lu.areaInput === areaInput);
      if(index>-1) landUses.splice(index,1);
    });

    entryDiv.appendChild(label);
    entryDiv.appendChild(areaInput);
    entryDiv.appendChild(removeBtn);
    landUseContainer.appendChild(entryDiv);

    landUses.push({ type: typeText, cValue, areaInput });
  });

  function validateInputs(vals){
    const { totalArea, totalRainfall, stormDuration, timesteps, canalLength, canalWidth, canalHeight, canalSlope } = vals;
    if (!(totalArea>0)) return "Total area must be positive.";
    if (!(totalRainfall>=0)) return "Total rainfall must be >= 0.";
    if (!(stormDuration>0)) return "Storm duration must be positive.";
    if (!(timesteps >= 1 && Number.isInteger(timesteps))) return "Timesteps must be a positive integer.";
    if (!(canalLength>0 && canalWidth>0 && canalHeight>0)) return "Canal dimensions must be positive.";
    if (!(canalSlope>0)) return "Canal slope must be positive.";
    if(landUses.length===0) return "Please add at least one land use.";
    for(const lu of landUses){
      const area = parseFloat(lu.areaInput.value);
      if(isNaN(area) || area<=0) return `Please enter a valid area for ${lu.type}`;
    }
    return null;
  }

  function manningOutflow(width, depth, slope, n, timestepHours){
    if (depth <= 0) return 0;
    const A = width * depth;
    const P = width + 2 * depth;
    const R = A / P;
    const Q = (1/n) * A * Math.pow(R, 2/3) * Math.sqrt(slope); // m³/s
    return Q * timestepHours * 3600; // convert to m³ per timestep
  }

  function calculateWeightedC(){
    let totalAreaSum = 0;
    let weightedSum = 0;
    for(const lu of landUses){
      const area = parseFloat(lu.areaInput.value);
      totalAreaSum += area;
      weightedSum += area * lu.cValue;
    }
    if(totalAreaSum > 0){
      return parseFloat((weightedSum / totalAreaSum).toFixed(2));
    } else {
      return null;
    }
  }

  function runSimulation(vals){
    const { totalArea, totalRainfall, stormDuration, timesteps, canalLength, canalWidth, canalHeight, canalSlope } = vals;
    const timestepHours = stormDuration / timesteps;
    const runoffC = calculateWeightedC();

    // Time of concentration
    const L = canalLength;
    const slope = canalSlope;
    const Tc = 0.01947 * Math.pow(L,0.77) * Math.pow(slope,-0.385); // minutes
    const Tc_hours = Tc / 60;

    // Triangular hyetograph
    const rainfall = [];
    const peakTime = Tc_hours; 
    const totalStormTime = stormDuration;
    for(let t=0; t<timesteps; t++){
        const tMid = t * timestepHours + timestepHours/2;
        let intensityFactor;
        if(tMid <= peakTime) intensityFactor = tMid / peakTime;
        else intensityFactor = (totalStormTime - tMid) / (totalStormTime - peakTime);
        intensityFactor = Math.max(0, intensityFactor);
        rainfall.push(totalRainfall * intensityFactor * timestepHours / (0.5 * totalStormTime));
    }

    const water_depth = [];
    const canalOutflowPerTimestep = manningOutflow(canalWidth, canalHeight, canalSlope, 0.015, timestepHours);

    for(let t=0; t<timesteps; t++){
        const prevDepth = t===0 ? 0 : water_depth[t-1];
        const inflowVol = (rainfall[t]/1000) * totalArea * runoffC + prevDepth/1000*totalArea;
        const outflowVol = Math.min(canalOutflowPerTimestep, inflowVol);
        const excessVol = inflowVol - outflowVol;
        const waterDepth = (excessVol / totalArea) * 1000;
        water_depth.push(waterDepth);
    }

    const rows = [];
    for(let t=0; t<timesteps; t++){
        let severity = "None";
        const wd = water_depth[t];
        if (wd>=30) severity="Severe";
        else if (wd>=20) severity="Moderate";
        else if (wd>=10) severity="Minor";
        rows.push({
            Hour: ((t+1)*timestepHours).toFixed(2),
            Rainfall_mm: Number(rainfall[t].toFixed(2)),
            WaterDepth_mm: Number(wd.toFixed(2)),
            FloodSeverity: severity
        });
    }

    const rainfallIntensityAvg = rainfall.reduce((a,b)=>a+b,0)/stormDuration;

    return { rows, meta: { rainfallIntensity: +rainfallIntensityAvg.toFixed(2), Tc: +Tc_hours.toFixed(2), C: runoffC },
             series: { rainfall, water_depth, timestepHours } };
  }

  function renderTable(rows){
    const table = document.createElement('table');
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = Object.keys(rows[0]);
    columns.forEach(c=>{ const th = document.createElement('th'); th.textContent=c; headerRow.appendChild(th); });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    rows.forEach(r=>{
      const tr = document.createElement('tr');
      columns.forEach(c=>{
        const td = document.createElement('td');
        td.textContent = r[c];
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableContainer.innerHTML = '';
    tableContainer.appendChild(table);
  }

  function drawChart(canvas, seriesToDraw, timestepHours=1){
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,canvas.clientWidth,canvas.clientHeight);

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const padding = {left:48, right:48, top:24, bottom:40};
    const n = seriesToDraw[Object.keys(seriesToDraw)[0]].length;
    const labels = Array.from({length:n}, (_,i)=>((i+1)*timestepHours).toFixed(1));
    const maxY = Math.max(...[].concat(...Object.values(seriesToDraw))) * 1.1 || 10;

    function xPos(i){ return padding.left + ((width - padding.left - padding.right) * (i) / Math.max(1,n-1)); }
    function yPos(val){ return padding.top + ((height - padding.top - padding.bottom)*(1 - (val / maxY))); }

    ctx.strokeStyle = "#eee"; ctx.lineWidth=1; ctx.beginPath();
    const gridCount = 6;
    for(let g=0; g<=gridCount; g++){
      const y = padding.top + (height - padding.top - padding.bottom)*(g/gridCount);
      ctx.moveTo(padding.left, y); ctx.lineTo(width - padding.right, y);
    }
    ctx.stroke();

    ctx.strokeStyle="#444"; ctx.lineWidth=1.2; ctx.beginPath();
    ctx.moveTo(padding.left, padding.top); ctx.lineTo(padding.left, height-padding.bottom);
    ctx.lineTo(width-padding.right, height-padding.bottom);
    ctx.stroke();

    ctx.fillStyle="#333"; ctx.font="12px system-ui"; ctx.textAlign="right";
    for(let g=0; g<=gridCount; g++){
      const val = (maxY*(gridCount-g)/gridCount);
      const y = padding.top + (height-padding.top-padding.bottom)*(g/gridCount);
      ctx.fillText(Math.round(val), padding.left-8, y+4);
    }

    ctx.textAlign="center";
    for(let i=0;i<n;i+=Math.ceil(n/10)||1){ ctx.fillText(labels[i]+"h", xPos(i), height-padding.bottom+16); }

    function drawLine(data,color){
      ctx.beginPath(); ctx.strokeStyle=color; ctx.lineWidth=1.8;
      for(let i=0;i<data.length;i++){
        const x=xPos(i), y=yPos(data[i]);
        if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
      }
      ctx.stroke();
      for(let i=0;i<data.length;i++){
        const x=xPos(i), y=yPos(data[i]);
        ctx.beginPath(); ctx.fillStyle=color; ctx.arc(x,y,3,0,Math.PI*2); ctx.fill();
      }
    }

    const colors = {rainfall:"#1f77b4", WaterDepth:"#d62728"}; 
    for(const key in seriesToDraw){ drawLine(seriesToDraw[key], colors[key] || "#000"); }

    ctx.fillStyle="#111"; ctx.font="14px system-ui"; ctx.textAlign="left";
  }

  simulateBtn.addEventListener('click', ()=>{
    const vals = {
      totalArea: parseFloat($('totalArea').value),
      totalRainfall: parseFloat($('totalRainfall').value),
      stormDuration: parseFloat($('stormDuration').value),
      timesteps: parseInt($('timesteps').value,10),
      canalLength: parseFloat($('canalLength').value),
      canalWidth: parseFloat($('canalWidth').value),
      canalHeight: parseFloat($('canalHeight').value),
      canalSlope: parseFloat($('canalSlope').value)
    };

    const err = validateInputs(vals);
    if(err){ alert(err); return; }

    simulateBtn.disabled = true;
    const result = runSimulation(vals);
    renderTable(result.rows);

    drawChart(chartOtherOutputs, {rainfall: result.series.rainfall, WaterDepth: result.series.water_depth}, result.series.timestepHours);

    summary.innerHTML = `Runoff coefficient (C): <strong>${result.meta.C}</strong>, 
    Time of concentration (Tc): <strong>${result.meta.Tc} h</strong>, 
    Average Rainfall Intensity: <strong>${result.meta.rainfallIntensity.toFixed(2)} mm/h</strong>`;

    setTimeout(()=>simulateBtn.disabled=false,250);
  });

  drawChart(chartOtherOutputs, {rainfall:[], WaterDepth:[]});
})();
