/* Gráficas compartidas de los paneles (Apache ECharts, render SVG para imprimir nítido).
 * Requiere echarts cargado antes:  cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js
 * Los colores salen de las variables CSS del tema (claro/oscuro).
 */
(function () {
  'use strict';

  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = (n) => Number(n || 0).toLocaleString('es-CO');
  const pct = (n, t) => (t ? Math.round((n / t) * 1000) / 10 : 0);
  const DIAS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const graficas = new Set();

  function tema() {
    return {
      texto: css('--text'), suave: css('--muted'), borde: css('--border'), fondo: css('--surface'),
      pista: css('--track'),
      serie: [css('--c1'), css('--c2'), css('--c3'), css('--c4'), css('--c5'), css('--c6'), css('--c7')],
      ok: css('--ok') || css('--c1'), pend: css('--pend') || css('--c3'), mal: css('--bad') || css('--c4'),
      nada: css('--none') || css('--c7'),
    };
  }

  /** Opciones comunes: tipografía, tooltip y botón de descarga PNG. */
  function base(t, extra) {
    return Object.assign({
      animationDuration: 700,
      textStyle: { fontFamily: 'ui-sans-serif,-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif', color: t.texto },
      tooltip: {
        backgroundColor: t.texto, borderWidth: 0, textStyle: { color: t.fondo, fontSize: 12 },
        extraCssText: 'border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.18);',
      },
      toolbox: {
        right: 0, top: 0, itemSize: 13,
        iconStyle: { borderColor: t.suave },
        feature: { saveAsImage: { title: 'Descargar PNG', pixelRatio: 2, backgroundColor: t.fondo } },
      },
    }, extra);
  }

  const ejeCat = (t, data, extra) => Object.assign({
    type: 'category', data,
    axisLine: { lineStyle: { color: t.borde } }, axisTick: { show: false },
    axisLabel: { color: t.suave, fontSize: 11 },
  }, extra);
  const ejeVal = (t, extra) => Object.assign({
    type: 'value', axisLabel: { color: t.suave, fontSize: 11, formatter: (v) => fmt(v) },
    splitLine: { lineStyle: { color: t.borde, type: 'dashed' } },
  }, extra);

  /** Monta (o reutiliza) una gráfica en un elemento y le aplica la opción construida por `fn(tema)`. */
  function montar(el, fn, alClic) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return null;
    let g = echarts.getInstanceByDom(el);
    if (!g) {
      el.innerHTML = ''; // quita el aviso de "sin datos" si lo había
      g = echarts.init(el, null, { renderer: 'svg' });
      graficas.add({ g, fn: () => fn(tema()) });
    } else {
      for (const x of graficas) if (x.g === g) x.fn = () => fn(tema());
    }
    g.setOption(fn(tema()), true);
    g.off('click');
    if (alClic) g.on('click', alClic);
    return g;
  }

  const sinDatos = (el, txt) => {
    if (typeof el === 'string') el = document.getElementById(el);
    if (!el) return;
    const g = echarts.getInstanceByDom(el);
    if (g) {
      for (const x of graficas) if (x.g === g) graficas.delete(x);
      g.dispose();
    }
    el.innerHTML = `<p class="vacio">${txt || 'Aún no hay datos.'}</p>`;
  };

  // ─── Tipos de gráfica ──────────────────────────────────────

  /** Embudo: etapas [{ nombre, valor }] con % sobre la primera y paso entre etapas. */
  function embudo(el, etapas, alClic) {
    if (!etapas.length || !etapas[0].valor) return sinDatos(el, 'Aún no se han enviado mensajes.');
    const max = etapas[0].valor;
    return montar(el, (t) => base(t, {
      tooltip: Object.assign(base(t).tooltip, {
        trigger: 'item',
        formatter: (p) => {
          const i = p.dataIndex;
          const prev = i > 0 ? etapas[i - 1].valor : null;
          return `<b>${p.name}</b><br>${fmt(p.value)} · ${pct(p.value, max)}% del total` +
            (prev ? `<br>${pct(p.value, prev)}% de «${etapas[i - 1].nombre}»` : '');
        },
      }),
      series: [{
        type: 'funnel', sort: 'none', left: '4%', right: '30%', top: 24, bottom: 8, minSize: '8%', gap: 3,
        label: {
          position: 'right', color: t.texto, fontSize: 12,
          formatter: (p) => `{n|${p.name}}\n{v|${fmt(p.value)}} {p|${pct(p.value, max)}%}`,
          rich: { n: { color: t.suave, fontSize: 11 }, v: { fontWeight: 650, fontSize: 14, color: t.texto }, p: { color: t.suave, fontSize: 11 } },
        },
        labelLine: { lineStyle: { color: t.borde } },
        itemStyle: { borderColor: t.fondo, borderWidth: 1 },
        emphasis: { label: { fontWeight: 700 } },
        data: etapas.map((e, i) => ({ name: e.nombre, value: e.valor, clave: e.clave, itemStyle: { color: e.color || t.serie[i % t.serie.length] } })),
      }],
    }), alClic);
  }

  /** Dona con total al centro: segmentos [{ nombre, valor, color?, clave? }]. */
  function dona(el, segs, centro, alClic) {
    const total = segs.reduce((s, x) => s + x.valor, 0);
    if (!total) return sinDatos(el, 'Aún no hay respuestas.');
    return montar(el, (t) => base(t, {
      tooltip: Object.assign(base(t).tooltip, { trigger: 'item', formatter: (p) => `<b>${p.name}</b><br>${fmt(p.value)} · ${p.percent}%` }),
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.suave, fontSize: 12 } },
      title: {
        text: fmt(total), subtext: centro || '', left: 'center', top: '34%',
        textStyle: { fontSize: 22, fontWeight: 650, color: t.texto }, subtextStyle: { color: t.suave, fontSize: 11 },
      },
      series: [{
        type: 'pie', radius: ['48%', '70%'], center: ['50%', '42%'], avoidLabelOverlap: true,
        itemStyle: { borderColor: t.fondo, borderWidth: 2, borderRadius: 4 },
        label: { show: false }, emphasis: { scaleSize: 6 },
        data: segs.map((s, i) => ({ name: s.nombre, value: s.valor, clave: s.clave, itemStyle: { color: s.color || t.serie[i % t.serie.length] } })),
      }],
    }), alClic);
  }

  /** Actividad diaria: barras por día + líneas acumuladas (eje derecho). series: [{ nombre, datos:{dia:c} }] */
  function actividadDiaria(el, dias, series) {
    if (!dias.length) return sinDatos(el, 'Aún no hay actividad.');
    const etq = dias.map((d) => d.slice(8, 10) + '/' + d.slice(5, 7));
    return montar(el, (t) => {
      const s = [];
      series.forEach((x, i) => {
        const col = x.color || t.serie[i];
        const diario = dias.map((d) => x.datos[d] || 0);
        let acc = 0;
        const acum = diario.map((v) => (acc += v));
        s.push({ name: x.nombre, type: 'bar', data: diario, itemStyle: { color: col, borderRadius: [3, 3, 0, 0], opacity: 0.55 }, barMaxWidth: 22 });
        s.push({ name: x.nombre + ' (acum.)', type: 'line', yAxisIndex: 1, data: acum, smooth: true, symbol: 'circle', symbolSize: 5,
          lineStyle: { width: 2.2, color: col }, itemStyle: { color: col }, areaStyle: i === 0 ? { color: col, opacity: 0.07 } : undefined });
      });
      return base(t, {
        tooltip: Object.assign(base(t).tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
        legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.suave, fontSize: 12 } },
        grid: { left: 8, right: 8, top: 34, bottom: 56, containLabel: true },
        xAxis: ejeCat(t, etq),
        yAxis: [ejeVal(t, { name: 'por día', nameTextStyle: { color: t.suave, fontSize: 10 } }),
          ejeVal(t, { name: 'acumulado', nameTextStyle: { color: t.suave, fontSize: 10, padding: [0, 28, 0, 0] }, splitLine: { show: false } })],
        dataZoom: dias.length > 21 ? [{ type: 'inside' }, { type: 'slider', height: 14, bottom: 24 }] : [],
        series: s,
      });
    });
  }

  /** Mapa de calor día de semana × hora. celdas: [{ dow:0-6 (lun=0), hora:0-23, c }] */
  function mapaCalor(el, celdas) {
    if (!celdas.length) return sinDatos(el, 'Aún no hay respuestas para ver horarios.');
    const max = Math.max(1, ...celdas.map((x) => x.c));
    const horas = Array.from({ length: 24 }, (_, h) => h + 'h');
    return montar(el, (t) => base(t, {
      tooltip: Object.assign(base(t).tooltip, {
        position: 'top',
        formatter: (p) => `<b>${DIAS[p.value[1]]} · ${p.value[0]}:00–${p.value[0]}:59</b><br>${fmt(p.value[2])} mensajes recibidos`,
      }),
      grid: { left: 8, right: 8, top: 30, bottom: 50, containLabel: true },
      xAxis: ejeCat(t, horas, { splitArea: { show: false }, axisLabel: { color: t.suave, fontSize: 10, interval: 1 } }),
      yAxis: ejeCat(t, DIAS, { inverse: true }),
      visualMap: {
        min: 0, max, calculable: false, orient: 'horizontal', left: 'center', bottom: 0, itemHeight: 120, itemWidth: 10,
        text: ['más', 'menos'], textStyle: { color: t.suave, fontSize: 11 },
        inRange: { color: [t.pista, t.serie[0]] },
      },
      series: [{
        type: 'heatmap', data: celdas.map((x) => [x.hora, x.dow, x.c]),
        itemStyle: { borderColor: t.fondo, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: t.texto, borderWidth: 1 } },
      }],
    }));
  }

  /** Línea de tiempo por hora con marcas de cada tanda de envío. serie: [{t:'YYYY-MM-DD HH:00', c}] */
  function lineaTiempo(el, serie, tandas) {
    if (!serie.length) return sinDatos(el, 'Aún no hay respuestas registradas.');
    const etq = serie.map((x) => { const [f, h] = x.t.split(' '); return `${f.slice(8, 10)}/${f.slice(5, 7)} ${h.slice(0, 2)}h`; });
    const idx = (bucket) => { const i = serie.findIndex((x) => x.t >= bucket); return i < 0 ? null : i; };
    return montar(el, (t) => base(t, {
      tooltip: Object.assign(base(t).tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      grid: { left: 8, right: 8, top: 34, bottom: 46, containLabel: true },
      xAxis: ejeCat(t, etq),
      yAxis: ejeVal(t),
      dataZoom: serie.length > 48 ? [{ type: 'inside', startValue: Math.max(0, serie.length - 48) }, { type: 'slider', height: 14, bottom: 8 }] : [],
      series: [{
        name: 'Mensajes recibidos', type: 'bar', data: serie.map((x) => x.c), barMaxWidth: 14,
        itemStyle: { color: t.serie[0], borderRadius: [2, 2, 0, 0] },
        emphasis: { itemStyle: { color: t.serie[2] } },
        markLine: {
          symbol: 'none', silent: false,
          lineStyle: { color: t.serie[3], type: 'dashed', width: 1.4 },
          label: { color: t.serie[3], fontWeight: 700, fontSize: 11, formatter: (p) => p.name },
          data: (tandas || []).map((x, k) => ({ name: `T${k + 1}`, xAxis: idx(x.bucket) })).filter((m) => m.xAxis != null),
        },
      }],
    }));
  }

  /** Barras horizontales apiladas. cats: nombres; series: [{ nombre, datos:[], color }] */
  function barrasApiladas(el, cats, series, alClic) {
    if (!cats.length) return sinDatos(el);
    return montar(el, (t) => base(t, {
      tooltip: Object.assign(base(t).tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      legend: { bottom: 0, icon: 'roundRect', itemWidth: 10, itemHeight: 10, textStyle: { color: t.suave, fontSize: 12 } },
      grid: { left: 8, right: 16, top: 30, bottom: 36, containLabel: true },
      xAxis: ejeVal(t),
      yAxis: ejeCat(t, cats, { inverse: true, axisLabel: { color: t.texto, fontSize: 12, width: 170, overflow: 'truncate' } }),
      series: series.map((s, i) => ({
        name: s.nombre, type: 'bar', stack: 'total', data: s.datos, barMaxWidth: 22,
        itemStyle: { color: s.color || t.serie[i] },
        emphasis: { focus: 'series' },
      })),
    }), alClic);
  }

  /** Barras horizontales simples: filas [{ nombre, valor, clave? }]. */
  function barras(el, filas, nombreSerie, alClic, color) {
    if (!filas.length) return sinDatos(el);
    return montar(el, (t) => base(t, {
      tooltip: Object.assign(base(t).tooltip, { trigger: 'axis', axisPointer: { type: 'shadow' } }),
      grid: { left: 8, right: 40, top: 30, bottom: 8, containLabel: true },
      xAxis: ejeVal(t),
      yAxis: ejeCat(t, filas.map((f) => f.nombre), { inverse: true, axisLabel: { color: t.texto, fontSize: 12, width: 220, overflow: 'truncate' } }),
      series: [{
        name: nombreSerie, type: 'bar', barMaxWidth: 20,
        data: filas.map((f) => ({ value: f.valor, clave: f.clave })),
        itemStyle: { color: color || t.serie[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: 'right', color: t.suave, fontSize: 11, formatter: (p) => fmt(p.value) },
      }],
    }), alClic);
  }

  // Redimensionar y re-tematizar.
  let tmr;
  window.addEventListener('resize', () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => graficas.forEach((x) => !x.g.isDisposed() && x.g.resize()), 120);
  });
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  (mq.addEventListener ? mq.addEventListener.bind(mq, 'change') : mq.addListener.bind(mq))(() =>
    graficas.forEach((x) => !x.g.isDisposed() && x.g.setOption(x.fn(), true))
  );
  window.addEventListener('beforeprint', () => graficas.forEach((x) => !x.g.isDisposed() && x.g.resize()));

  window.Graficas = { embudo, dona, actividadDiaria, mapaCalor, lineaTiempo, barrasApiladas, barras, sinDatos, fmt, pct };
})();
