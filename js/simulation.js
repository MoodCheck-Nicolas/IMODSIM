(function(){
  const $ = id => document.getElementById(id);
  const simulateBtn = $('simulateBtn');
  const chartOtherOutputs = $('chartOtherOutputs');
  const tableContainer = $('tableContainer');
  const summary = $('summary');

  function validateInputs(vals){
    const { totalArea, totalRainfall, stormDuration, timesteps, canalLength, canalWidth, canalHeight, canalSlope } = vals;
    if (!(totalArea>0)) return "Total area must be greater than 0.";
    if (!(totalRainfall>0)) return "Total rainfall must be greater than 0.";
    if (!(stormDuration>0)) return "Storm duration must be greater than 0.";
    if (!(timesteps >= 1 && Number.isInteger(timesteps))) return "Timesteps must be a positive integer.";
    if (!(canalLength>0 && canalWidth>0 && canalHeight>0)) return "Canal dimensions greater than 0.";
    if (!(canalSlope>0)) return "Canal slope greater than 0.";
    return null;
  }

  function manningOutflow(width, depth, slope, n, timestepHours){
    if (depth <= 0) return 0;
    const A = width * depth;
    const P = width + 2 * depth;
    const R = A / P;
    const Q = (1/n) * A * Math.pow(R, 2/3) * Math.sqrt(slope); // m3/s
    return Q * timestepHours * 3600; // convert to m3 per timestep
  }

  function runSimulation(vals){
    const { totalArea, totalRainfall, stormDuration, timesteps, canalLength, canalWidth, canalHeight, canalSlope } = vals;
    const timestepHours = stormDuration / timesteps;
    const runoffC = 0.61;
    const L = canalLength;
    const slope = canalSlope;
    const Tc = 0.01947 * Math.pow(L,0.77) * Math.pow(slope,-0.385);
    const Tc_hours = Tc / 60;

    // Max canal capacity
    const canalMaxVolume = canalLength * canalWidth * canalHeight;

    // Triangular hyetograph
    const rainfall = [];
    const peakTime = Math.min(Tc_hours, stormDuration*0.5);
    const totalStormTime = stormDuration;
    for(let t=0; t<timesteps; t++){
        const tMid = t * timestepHours + timestepHours/2;
        let intensityFactor;
        if(tMid <= peakTime) intensityFactor = tMid / peakTime;
        else intensityFactor = (totalStormTime - tMid) / Math.max(0.0001, (totalStormTime - peakTime));
        intensityFactor = Math.max(0, intensityFactor);
        const peakIntensity = (2 * totalRainfall) / totalStormTime; // mm/h
        const intensity_mm_per_h = peakIntensity * intensityFactor;
        rainfall.push(intensity_mm_per_h * timestepHours); // mm per timestep
    }

    const water_depth = [];                 
    let canalStorage_m3 = 0;   // water inside canal
    let surfaceFlood_m3 = 0;   // water above canal

    for(let t=0; t<timesteps; t++){
        const rain_m = rainfall[t] / 1000;
        const rainVolume_m3 = rain_m * totalArea;

        // runoff generated
        const runoffVolume_m3 = runoffC * rainVolume_m3;

        // add to total water
        let totalIncoming = runoffVolume_m3 + canalStorage_m3 + surfaceFlood_m3;

        // split between canal and surface
        canalStorage_m3 = Math.min(totalIncoming, canalMaxVolume);
        surfaceFlood_m3 = totalIncoming - canalStorage_m3;

        // Manning outflow (limited to canal depth)
        const flowDepthForManning_m = canalStorage_m3 / (canalLength * canalWidth);
        const canalOutflowPerTimestep = manningOutflow(canalWidth, Math.min(flowDepthForManning_m, canalHeight), canalSlope, 0.015, timestepHours);

        // actual outflow cannot exceed water stored in canal
        const actualOutflow_m3 = Math.min(canalOutflowPerTimestep, canalStorage_m3);

        // update canal & flood storage
        canalStorage_m3 -= actualOutflow_m3;
        // surfaceFlood_m3 remains as is (no quick outflow assumed)

        const floodAreaFactor = 0.2;
        const floodArea = totalArea * floodAreaFactor;
        const waterDepth_m = surfaceFlood_m3 / floodArea;
        const waterDepth_mm = waterDepth_m * 1000;

        water_depth.push(+waterDepth_mm.toFixed(2));
    }

    const rows = [];
    for(let t=0; t<timesteps; t++){
        const wd = water_depth[t];
        let severity = "None";
        if (wd>=600) severity="Extreme Flooding";   
        else if (wd>=301) severity="Severe Flooding"; 
        else if (wd>=151) severity="Moderate Flooding";  
        else if (wd>=51) severity="Minor Flooding";   
        else if (wd>=0) severity="No flooding";    

        rows.push({
            Hour: ((t+1)*timestepHours).toFixed(2),
            Rainfall_mm: Number(rainfall[t].toFixed(2)),
            WaterDepth_mm: Number(wd),
            FloodSeverity: severity
        });
    }

    const rainfallIntensityAvg = totalRainfall / stormDuration;

    return {
      rows,
      meta: {
        rainfallIntensity: +rainfallIntensityAvg.toFixed(2),
        Tc: +Tc_hours.toFixed(2),
        C: runoffC
      },
      series: {
        rainfall,               
        water_depth,            
        timestepHours
      }
    };
  }

  function renderTable(rows){
    const table = document.createElement('table');
    table.style.width='100%';
    table.style.borderCollapse='collapse';
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const columns = Object.keys(rows[0]);
    columns.forEach(c=>{
      const th = document.createElement('th');
      th.textContent=c;
      headerRow.appendChild(th);
    });
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
    const keys = Object.keys(seriesToDraw);
    const n = seriesToDraw[keys[0]].length || 1;
    const labels = Array.from({length:n}, (_,i)=>((i+1)*timestepHours).toFixed(1));
    let combined = [];
    keys.forEach(k=> combined = combined.concat(seriesToDraw[k]));
    const maxY = Math.max(...combined) * 1.1 || 10;

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
    for(const key in seriesToDraw){
      const mapKey = key === 'water_depth' ? 'WaterDepth' : key;
      drawLine(seriesToDraw[key], colors[mapKey] || '#000');
    }
  }

  simulateBtn.addEventListener('click', ()=>{
    const vals = {
      totalArea: 19274.25,
      totalRainfall: parseFloat($('totalRainfall').value),
      stormDuration: parseFloat($('stormDuration').value),
      timesteps: parseInt($('timesteps').value,10),
      canalLength: 176.16,
      canalWidth: 0.3045,
      canalHeight: 0.33,
      canalSlope: 0.01047
    };
    const err = validateInputs(vals);
    if(err){ alert(err); return; }

    simulateBtn.disabled=true;
    const result = runSimulation(vals);
    renderTable(result.rows);

    drawChart(chartOtherOutputs, {rainfall: result.series.rainfall, water_depth: result.series.water_depth}, result.series.timestepHours);

    summary.innerHTML = `Runoff coefficient (C): <strong>${result.meta.C}</strong>, 
    Time of concentration (Tc): <strong>${result.meta.Tc} h</strong>`;

    setTimeout(()=>simulateBtn.disabled=false,250);
  });

  drawChart(chartOtherOutputs, {rainfall:[], water_depth:[]});
})();