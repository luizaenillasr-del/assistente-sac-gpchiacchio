<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Gestão de Manifestações — Grupo Chiacchio</title>
<style>
  :root {
    --red: #C8102E;
    --red-dark: #9B0D22;
    --red-light: #F5E0E3;
    --sidebar-bg: #1A0508;
    --sidebar-text: #F5D0D5;
    --sidebar-active: #C8102E;
    --white: #FFFFFF;
    --gray-50: #F9FAFB;
    --gray-100: #F3F4F6;
    --gray-200: #E5E7EB;
    --gray-300: #D1D5DB;
    --gray-400: #9CA3AF;
    --gray-500: #6B7280;
    --gray-700: #374151;
    --gray-900: #111827;
    --yellow: #F59E0B;
    --yellow-light: #FEF3C7;
    --green: #10B981;
    --green-light: #D1FAE5;
    --orange: #F97316;
    --orange-light: #FED7AA;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: var(--gray-50); color: var(--gray-900); display: flex; height: 100vh; overflow: hidden; font-size: 14px; }

  /* SIDEBAR */
  .sidebar { width: 180px; background: var(--sidebar-bg); color: var(--sidebar-text); display: flex; flex-direction: column; flex-shrink: 0; overflow-y: auto; }
  .sidebar-logo { padding: 16px; border-bottom: 1px solid rgba(255,255,255,0.08); }
  .sidebar-logo-icon { width: 36px; height: 36px; background: var(--red); border-radius: 8px; display: flex; align-items: center; justify-content: center; margin-bottom: 8px; }
  .sidebar-logo-icon svg { width: 20px; height: 20px; fill: white; }
  .sidebar-logo h2 { font-size: 13px; font-weight: 700; color: white; line-height: 1.3; }
  .sidebar-logo p { font-size: 11px; color: var(--sidebar-text); opacity: 0.7; margin-top: 2px; }
  .sidebar-section { padding: 16px 12px 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; color: rgba(255,255,255,0.35); }
  .sidebar-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; border-radius: 6px; margin: 1px 8px; color: rgba(255,255,255,0.65); font-size: 13px; font-weight: 500; transition: all 0.15s; }
  .sidebar-item:hover { background: rgba(255,255,255,0.08); color: white; }
  .sidebar-item.active { background: var(--red); color: white; }
  .sidebar-item svg { width: 16px; height: 16px; flex-shrink: 0; }
  .sidebar-bottom { margin-top: auto; padding: 12px 8px; border-top: 1px solid rgba(255,255,255,0.08); }
  .sidebar-link { font-size: 11px; color: rgba(255,255,255,0.45); display: flex; align-items: center; gap: 4px; padding: 4px; cursor: pointer; }
  .sidebar-link:hover { color: rgba(255,255,255,0.7); }
  .sidebar-user { display: flex; align-items: center; gap: 8px; padding: 8px; margin-top: 8px; }
  .sidebar-user-avatar { width: 32px; height: 32px; background: var(--red-dark); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 12px; font-weight: 600; flex-shrink: 0; }
  .sidebar-user-info { min-width: 0; }
  .sidebar-user-name { font-size: 12px; font-weight: 600; color: white; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sidebar-user-role { font-size: 11px; color: rgba(255,255,255,0.45); }

  /* MAIN */
  .main { flex: 1; overflow-y: auto; display: flex; flex-direction: column; }
  .page { display: none; flex-direction: column; flex: 1; }
  .page.active { display: flex; }

  /* TOPBAR */
  .topbar { padding: 20px 28px 0; }
  .breadcrumb { font-size: 12px; color: var(--gray-400); margin-bottom: 4px; }
  .breadcrumb span { color: var(--gray-500); }
  .page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20px; }
  .page-title { font-size: 24px; font-weight: 700; color: var(--gray-900); }
  .page-actions { display: flex; align-items: center; gap: 10px; }
  .badge-mockup { font-size: 11px; color: var(--gray-400); }

  /* BUTTONS */
  .btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 14px; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; border: none; transition: all 0.15s; }
  .btn-primary { background: var(--red); color: white; }
  .btn-primary:hover { background: var(--red-dark); }
  .btn-secondary { background: white; color: var(--gray-700); border: 1px solid var(--gray-200); }
  .btn-secondary:hover { background: var(--gray-50); }
  .btn-ghost { background: transparent; color: var(--red); border: 1px solid var(--red); }
  .btn-ghost:hover { background: var(--red-light); }
  .btn svg { width: 14px; height: 14px; }

  /* CONTENT */
  .content { padding: 0 28px 28px; flex: 1; }

  /* CARDS */
  .card { background: white; border: 1px solid var(--gray-200); border-radius: 12px; }
  .card-pad { padding: 20px; }

  /* KPI GRID */
  .kpi-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
  .kpi-card { background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 16px; }
  .kpi-card.highlight { background: var(--red); color: white; border-color: var(--red); }
  .kpi-label { font-size: 12px; font-weight: 500; opacity: 0.75; margin-bottom: 8px; line-height: 1.3; }
  .kpi-value { font-size: 28px; font-weight: 800; line-height: 1; margin-bottom: 4px; }
  .kpi-delta { font-size: 11px; opacity: 0.7; display: flex; align-items: center; gap: 3px; }
  .kpi-delta.up { color: var(--green); }
  .kpi-delta.down { color: var(--red); }
  .kpi-card.highlight .kpi-delta { color: rgba(255,255,255,0.75); }

  /* FILTERS */
  .filters { display: flex; align-items: center; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
  .filter-group { display: flex; background: white; border: 1px solid var(--gray-200); border-radius: 8px; overflow: hidden; }
  .filter-btn { padding: 6px 12px; font-size: 12px; font-weight: 500; cursor: pointer; border: none; background: transparent; color: var(--gray-500); transition: all 0.1s; }
  .filter-btn.active { background: var(--red); color: white; }
  .filter-btn:hover:not(.active) { background: var(--gray-50); }
  .filter-select { display: flex; align-items: center; gap: 4px; padding: 6px 10px; background: white; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 12px; cursor: pointer; color: var(--gray-700); }
  .filter-select strong { color: var(--gray-900); }
  .filter-select svg { width: 12px; height: 12px; color: var(--gray-400); }
  .filter-last { margin-left: auto; font-size: 11px; color: var(--gray-400); }

  /* GRID 2/3 */
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 16px; }
  .grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; margin-bottom: 16px; }

  /* SECTION CARD */
  .section-card { background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 20px; }
  .section-title { font-size: 15px; font-weight: 700; margin-bottom: 2px; }
  .section-sub { font-size: 12px; color: var(--gray-400); margin-bottom: 16px; }

  /* ETAPAS */
  .etapa-row { display: flex; align-items: center; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid var(--gray-100); }
  .etapa-row:last-child { border-bottom: none; }
  .etapa-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--red); flex-shrink: 0; }
  .etapa-label { flex: 1; margin-left: 10px; font-size: 13px; }
  .etapa-count { font-size: 13px; font-weight: 600; color: var(--gray-700); }
  .badge-alert { background: var(--red); color: white; font-size: 10px; font-weight: 700; padding: 2px 6px; border-radius: 20px; margin-left: 6px; }

  /* DONUT CHART */
  .donut-wrap { display: flex; align-items: center; gap: 20px; }
  .donut-svg-wrap { position: relative; flex-shrink: 0; }
  .donut-center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .donut-center-num { font-size: 18px; font-weight: 800; color: var(--gray-900); }
  .donut-center-label { font-size: 10px; color: var(--gray-400); }
  .donut-legend { display: flex; flex-direction: column; gap: 6px; }
  .legend-item { display: flex; align-items: center; gap: 6px; font-size: 12px; }
  .legend-dot { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .legend-label { color: var(--gray-600); flex: 1; }
  .legend-val { font-weight: 600; color: var(--gray-800); }
  .legend-pct { color: var(--gray-400); font-size: 11px; }

  /* BAR CHART */
  .bar-chart { display: flex; align-items: flex-end; gap: 6px; height: 120px; }
  .bar-col { display: flex; flex-direction: column; align-items: center; gap: 3px; flex: 1; }
  .bar-val { font-size: 10px; font-weight: 600; color: var(--gray-600); }
  .bar { background: var(--red); border-radius: 3px 3px 0 0; width: 100%; transition: opacity 0.2s; }
  .bar.current { background: var(--red-dark); }
  .bar:hover { opacity: 0.8; }
  .bar-label { font-size: 9px; color: var(--gray-400); text-align: center; }
  .bar-axis { display: flex; gap: 6px; margin-top: 4px; }

  /* PENDENCIAS TABLE */
  .ptable { width: 100%; border-collapse: collapse; }
  .ptable th { text-align: left; font-size: 11px; font-weight: 600; color: var(--gray-400); padding: 6px 0; border-bottom: 1px solid var(--gray-100); }
  .ptable td { padding: 8px 0; font-size: 13px; border-bottom: 1px solid var(--gray-50); vertical-align: middle; }
  .ptable tr:last-child td { border-bottom: none; }

  /* FILA TABLE */
  .fila-table { width: 100%; border-collapse: collapse; }
  .fila-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--gray-400); padding: 8px 12px; background: var(--gray-50); }
  .fila-table td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid var(--gray-100); }
  .fila-table tr:last-child td { border-bottom: none; }
  .fila-table .num { font-weight: 700; color: var(--gray-900); }
  .prazo-badge { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .prazo-badge.atrasado { background: #FEE2E2; color: #DC2626; }
  .prazo-badge.vence { background: var(--yellow-light); color: #92400E; }
  .prazo-badge.ok { background: var(--green-light); color: #065F46; }
  .link-abrir { color: var(--red); font-weight: 600; font-size: 13px; cursor: pointer; text-decoration: none; }
  .link-abrir:hover { text-decoration: underline; }

  /* STATUS BADGE */
  .status-badge { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .status-badge.em-andamento { background: #EFF6FF; color: #1D4ED8; }
  .status-badge.encerrada { background: var(--green-light); color: #065F46; }
  .status-badge.atrasada { background: #FEE2E2; color: #DC2626; }
  .status-badge.registro { background: var(--gray-100); color: var(--gray-600); }
  .status-badge.setores { background: #F3E8FF; color: #7C3AED; }
  .status-badge.decisao { background: #FEF3C7; color: #92400E; }
  .status-badge.devolutiva { background: #ECFDF5; color: #065F46; }

  /* PROCEDENCIA BADGE */
  .proc-badge { display: inline-flex; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .proc-badge.procedente { background: #ECFDF5; color: #065F46; }
  .proc-badge.parcialmente { background: var(--yellow-light); color: #92400E; }

  /* PROGRESS BAR */
  .progress-bar { height: 6px; background: var(--gray-100); border-radius: 3px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--red); border-radius: 3px; }
  .progress-fill.gray { background: var(--gray-300); }
  .progress-fill.yellow { background: var(--yellow); }

  /* PROCEDENCIA BAR */
  .proc-bars { display: flex; gap: 2px; height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 12px; }
  .proc-seg { height: 100%; }

  /* STEPPER */
  .stepper { display: flex; align-items: center; gap: 0; margin-bottom: 24px; background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 14px 20px; overflow-x: auto; }
  .step { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .step-num { width: 22px; height: 22px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 700; flex-shrink: 0; }
  .step-num.done { background: var(--red); color: white; }
  .step-num.active { background: var(--red); color: white; }
  .step-num.todo { background: var(--gray-100); color: var(--gray-400); }
  .step-label { font-size: 12px; font-weight: 600; }
  .step-label.done { color: var(--gray-500); }
  .step-label.active { color: var(--red); }
  .step-label.todo { color: var(--gray-400); }
  .step-line { width: 32px; height: 2px; background: var(--gray-200); margin: 0 4px; flex-shrink: 0; }
  .step-line.done { background: var(--red); }

  /* MANIFESTACAO HEADER */
  .man-header { background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 14px 20px; display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
  .man-header-icon { width: 36px; height: 36px; background: var(--red-light); border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .man-header-num { font-size: 16px; font-weight: 800; }
  .man-header-tags { display: flex; gap: 6px; }
  .tag { display: inline-flex; padding: 3px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .tag.red { background: var(--red); color: white; }
  .tag.gray { background: var(--gray-100); color: var(--gray-600); }
  .tag.blue { background: #EFF6FF; color: #1D4ED8; }
  .man-header-info { margin-left: auto; text-align: right; }
  .man-header-empresa { font-weight: 700; font-size: 14px; }
  .man-header-sub { font-size: 11px; color: var(--gray-400); margin-top: 2px; }

  /* FORM */
  .form-section { background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .form-section-title { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
  .form-section-icon { width: 28px; height: 28px; background: var(--red-light); border-radius: 6px; display: flex; align-items: center; justify-content: center; }
  .form-section-icon svg { width: 14px; height: 14px; color: var(--red); }
  .form-section-name { font-size: 14px; font-weight: 700; }
  .form-section-desc { font-size: 12px; color: var(--gray-400); margin-bottom: 16px; margin-left: 36px; }
  .form-row { display: grid; gap: 12px; margin-bottom: 12px; }
  .form-row.cols-4 { grid-template-columns: repeat(4, 1fr); }
  .form-row.cols-2 { grid-template-columns: 1fr 1fr; }
  .form-row.cols-3 { grid-template-columns: 1fr 1fr 1fr; }
  .form-group { display: flex; flex-direction: column; gap: 4px; }
  .form-label { font-size: 11px; font-weight: 600; color: var(--gray-500); }
  .form-input { padding: 8px 10px; border: 1px solid var(--gray-200); border-radius: 6px; font-size: 13px; color: var(--gray-900); background: white; outline: none; }
  .form-input:focus { border-color: var(--red); box-shadow: 0 0 0 2px var(--red-light); }
  .form-input:read-only { background: var(--gray-50); color: var(--gray-500); }
  .form-textarea { padding: 10px; border: 1px solid var(--gray-200); border-radius: 6px; font-size: 13px; min-height: 100px; resize: vertical; font-family: inherit; outline: none; }
  .form-textarea:focus { border-color: var(--red); box-shadow: 0 0 0 2px var(--red-light); }

  /* CANAL BTNS */
  .canal-btns { display: flex; gap: 6px; flex-wrap: wrap; }
  .canal-btn { padding: 6px 12px; border-radius: 20px; border: 1px solid var(--gray-200); background: white; font-size: 12px; font-weight: 500; cursor: pointer; color: var(--gray-600); }
  .canal-btn.active { background: var(--red); color: white; border-color: var(--red); }
  .canal-btn:hover:not(.active) { border-color: var(--red); color: var(--red); }

  /* TIPO BTNS */
  .tipo-btns { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }

  /* ALERT BOX */
  .alert-box { padding: 10px 14px; border-radius: 8px; font-size: 12px; display: flex; align-items: flex-start; gap: 8px; }
  .alert-box.red { background: #FEF2F2; border: 1px solid #FECACA; color: #991B1B; }
  .alert-box.yellow { background: var(--yellow-light); border: 1px solid #FDE68A; color: #92400E; }
  .alert-box.green { background: var(--green-light); border: 1px solid #A7F3D0; color: #065F46; }
  .alert-box.blue { background: #EFF6FF; border: 1px solid #BFDBFE; color: #1D4ED8; }

  /* SIDEBAR RESUMO */
  .sidebar-resumo { display: flex; flex-direction: column; gap: 12px; }
  .resumo-item { display: flex; align-items: center; gap: 8px; font-size: 12px; }
  .resumo-check { width: 18px; height: 18px; border-radius: 50%; background: var(--green); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .resumo-check svg { width: 10px; height: 10px; color: white; }
  .resumo-check.pending { background: var(--gray-200); }
  .resumo-label { flex: 1; font-weight: 500; }
  .resumo-sub { font-size: 11px; color: var(--gray-400); }

  /* LAYOUT COM ASIDE */
  .page-layout { display: grid; grid-template-columns: 1fr 240px; gap: 16px; }
  .page-layout-wide { display: grid; grid-template-columns: 1fr 240px; gap: 16px; }
  .aside { display: flex; flex-direction: column; gap: 12px; }

  /* BANCO TABLE */
  .banco-table { width: 100%; border-collapse: collapse; }
  .banco-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--gray-400); padding: 10px 12px; background: var(--gray-50); border-bottom: 1px solid var(--gray-200); }
  .banco-table td { padding: 12px 12px; font-size: 13px; border-bottom: 1px solid var(--gray-100); vertical-align: middle; }
  .banco-table tr:hover td { background: var(--gray-50); }
  .banco-table tr:last-child td { border-bottom: none; }
  .cliente-primary { font-weight: 600; color: var(--gray-900); }
  .cliente-secondary { font-size: 11px; color: var(--gray-400); margin-top: 1px; }
  .num-bold { font-weight: 800; color: var(--gray-900); }
  .num-date { font-size: 11px; color: var(--gray-400); margin-top: 1px; }

  /* SEARCH */
  .search-wrap { position: relative; flex: 1; }
  .search-wrap svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); width: 14px; height: 14px; color: var(--gray-400); }
  .search-input { width: 100%; padding: 9px 10px 9px 32px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 13px; outline: none; background: white; }
  .search-input:focus { border-color: var(--red); }

  /* TABS */
  .tabs-bar { display: flex; gap: 0; background: var(--gray-100); border-radius: 8px; padding: 3px; margin-bottom: 16px; overflow-x: auto; }
  .tab-btn { padding: 6px 14px; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; border: none; background: transparent; color: var(--gray-500); white-space: nowrap; }
  .tab-btn.active { background: white; color: var(--gray-900); box-shadow: 0 1px 3px rgba(0,0,0,0.08); }

  /* ANALISE IA */
  .ia-card { background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 20px; margin-bottom: 16px; }
  .ia-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px; }
  .ia-title { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 700; }
  .ia-title-icon { width: 28px; height: 28px; background: linear-gradient(135deg, #F97316, #C8102E); border-radius: 6px; display: flex; align-items: center; justify-content: center; }
  .ia-title-icon svg { width: 14px; height: 14px; color: white; }
  .ia-badge { font-size: 11px; background: var(--orange-light); color: #C2410C; padding: 3px 8px; border-radius: 20px; font-weight: 600; }
  .ia-sub { font-size: 12px; color: var(--gray-400); margin-bottom: 12px; }
  .ia-resumo { font-size: 13px; color: var(--gray-700); line-height: 1.6; margin-bottom: 16px; }
  .classificacao-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .classif-item { }
  .classif-label { font-size: 11px; color: var(--gray-400); font-weight: 600; margin-bottom: 2px; }
  .classif-value { font-size: 14px; font-weight: 700; margin-bottom: 4px; }
  .classif-bar { height: 4px; background: var(--gray-100); border-radius: 2px; overflow: hidden; margin-bottom: 2px; }
  .classif-fill { height: 100%; background: var(--red); border-radius: 2px; }
  .classif-pct { font-size: 11px; color: var(--gray-400); }

  /* SETORES PAGE */
  .setores-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 20px; }
  .setor-kpi { background: white; border: 1px solid var(--gray-200); border-radius: 12px; padding: 16px; cursor: pointer; transition: all 0.15s; }
  .setor-kpi:hover { border-color: var(--red); }
  .setor-kpi h3 { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
  .setor-kpi .num-big { font-size: 24px; font-weight: 800; color: var(--red); }
  .setor-kpi .sub { font-size: 11px; color: var(--gray-400); margin-bottom: 8px; }
  .setor-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; margin-top: 8px; }
  .setor-stat { }
  .setor-stat-label { font-size: 10px; color: var(--gray-400); }
  .setor-stat-val { font-size: 12px; font-weight: 600; }
  .setor-stat-val.red { color: var(--red); }

  /* HEATMAP */
  .heatmap { border-collapse: collapse; width: 100%; }
  .heatmap th { font-size: 11px; color: var(--gray-400); padding: 6px 10px; text-align: center; }
  .heatmap th:first-child { text-align: left; }
  .heatmap td { padding: 8px 10px; text-align: center; font-size: 13px; font-weight: 600; border-radius: 4px; }
  .heatmap td:first-child { text-align: left; font-weight: 600; color: var(--gray-700); font-size: 13px; }
  .heat-0 { background: #FFF5F5; color: var(--gray-400); }
  .heat-1 { background: #FEE2E2; color: #B91C1C; }
  .heat-2 { background: #FECACA; color: #991B1B; }
  .heat-3 { background: #F87171; color: white; }
  .heat-4 { background: #C8102E; color: white; }

  /* RNC TABLE */
  .rnc-table { width: 100%; border-collapse: collapse; }
  .rnc-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--gray-400); padding: 8px 12px; background: var(--gray-50); border-bottom: 1px solid var(--gray-200); }
  .rnc-table td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid var(--gray-100); vertical-align: top; }
  .rnc-table tr:last-child td { border-bottom: none; }
  .rnc-acao { font-size: 11px; color: var(--gray-400); margin-top: 2px; }

  /* TIMELINE */
  .timeline { display: flex; flex-direction: column; gap: 0; }
  .tl-item { display: flex; gap: 10px; padding-bottom: 12px; position: relative; }
  .tl-item:not(:last-child)::before { content: ''; position: absolute; left: 5px; top: 14px; bottom: 0; width: 1px; background: var(--gray-200); }
  .tl-dot { width: 12px; height: 12px; border-radius: 50%; background: var(--red); flex-shrink: 0; margin-top: 2px; }
  .tl-content { flex: 1; }
  .tl-label { font-size: 12px; font-weight: 600; color: var(--gray-800); }
  .tl-meta { font-size: 11px; color: var(--gray-400); margin-top: 1px; }

  /* BASE CONHECIMENTO */
  .bc-layout { display: grid; grid-template-columns: 200px 1fr 260px; gap: 0; height: 100%; }
  .bc-sidebar { border-right: 1px solid var(--gray-200); padding: 16px; background: white; }
  .bc-sidebar-section { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: var(--gray-400); margin: 12px 0 6px; }
  .bc-sidebar-item { display: flex; justify-content: space-between; align-items: center; padding: 5px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; color: var(--gray-600); }
  .bc-sidebar-item:hover { background: var(--gray-50); }
  .bc-sidebar-item.active { background: var(--red-light); color: var(--red); font-weight: 600; }
  .bc-sidebar-count { font-size: 11px; font-weight: 600; color: var(--gray-400); }
  .bc-list { padding: 16px; background: var(--gray-50); border-right: 1px solid var(--gray-200); overflow-y: auto; }
  .bc-item { background: white; border: 1px solid var(--gray-200); border-radius: 10px; padding: 14px; margin-bottom: 8px; cursor: pointer; transition: all 0.15s; }
  .bc-item:hover, .bc-item.active { border-color: var(--red); }
  .bc-item-title { font-size: 13px; font-weight: 700; margin-bottom: 4px; }
  .bc-item-tags { display: flex; gap: 4px; flex-wrap: wrap; }
  .bc-tag { font-size: 10px; padding: 2px 6px; border-radius: 4px; background: var(--gray-100); color: var(--gray-600); font-weight: 500; }
  .bc-tag.red { background: var(--red-light); color: var(--red); }
  .bc-tag.vigente { background: var(--green-light); color: #065F46; }
  .bc-tag.vencido { background: var(--yellow-light); color: #92400E; }
  .bc-detail { padding: 20px; background: white; }
  .bc-detail-badges { display: flex; gap: 6px; margin-bottom: 12px; }
  .bc-detail-title { font-size: 20px; font-weight: 800; margin-bottom: 16px; }
  .bc-meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
  .bc-meta-item { }
  .bc-meta-label { font-size: 11px; color: var(--gray-400); }
  .bc-meta-val { font-size: 13px; font-weight: 600; }

  /* MATRIZ */
  .matriz-table { width: 100%; border-collapse: collapse; }
  .matriz-table th { text-align: left; font-size: 11px; font-weight: 600; color: var(--gray-400); padding: 8px 12px; background: var(--gray-50); border-bottom: 1px solid var(--gray-200); }
  .matriz-table td { padding: 10px 12px; font-size: 13px; border-bottom: 1px solid var(--gray-100); vertical-align: middle; }
  .prioridade-badge { display: inline-flex; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .prioridade-badge.alta { background: #FEE2E2; color: #DC2626; }
  .prioridade-badge.media { background: var(--yellow-light); color: #92400E; }
  .prioridade-badge.baixa { background: var(--gray-100); color: var(--gray-500); }
  .rnc-badge { display: inline-flex; padding: 2px 8px; border-radius: 20px; font-size: 11px; font-weight: 600; }
  .rnc-badge.sim { background: var(--red-light); color: var(--red); }
  .rnc-badge.nao { background: var(--gray-100); color: var(--gray-500); }
  .edit-icon { color: var(--gray-300); cursor: pointer; }
  .edit-icon:hover { color: var(--red); }

  /* PAGINATION */
  .pagination { display: flex; align-items: center; justify-content: space-between; padding: 12px 0; }
  .pagination-info { font-size: 12px; color: var(--gray-400); }
  .pagination-btns { display: flex; gap: 4px; }
  .page-btn { width: 32px; height: 32px; border-radius: 6px; border: 1px solid var(--gray-200); background: white; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .page-btn.active { background: var(--red); color: white; border-color: var(--red); }
  .page-btn:hover:not(.active) { background: var(--gray-50); }

  /* LOADING */
  .loading { display: flex; align-items: center; justify-content: center; padding: 40px; color: var(--gray-400); font-size: 13px; gap: 8px; }
  .spinner { width: 16px; height: 16px; border: 2px solid var(--gray-200); border-top-color: var(--red); border-radius: 50%; animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  /* SCROLLBAR */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--gray-200); border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: var(--gray-300); }

  /* RESPONSIVE FIXES */
  @media (max-width: 1200px) {
    .kpi-grid, .setores-grid { grid-template-columns: repeat(3, 1fr); }
  }

  /* ===== NOVO FLUXO OPERACIONAL / IA ===== */
  .clickable-card { cursor:pointer; transition:transform .15s, box-shadow .15s, border-color .15s; }
  .clickable-card:hover { transform:translateY(-1px); box-shadow:0 6px 18px rgba(17,24,39,.08); border-color:var(--gray-300); }
  .ai-live-card { border:1px solid #F0D8DC; background:#FFF9FA; }
  .ai-live-head { display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px; }
  .ai-live-badge { display:inline-flex;align-items:center;gap:5px;background:#F5E0E3;color:var(--red);padding:4px 8px;border-radius:20px;font-size:10px;font-weight:700; }
  .ai-live-dot { width:6px;height:6px;border-radius:50%;background:var(--green); }
  .ai-live-grid { display:grid;grid-template-columns:1fr 1fr;gap:8px; }
  .ai-mini { background:white;border:1px solid var(--gray-200);border-radius:8px;padding:9px; }
  .ai-mini-label { font-size:10px;color:var(--gray-400);text-transform:uppercase;font-weight:700;margin-bottom:3px; }
  .ai-mini-value { font-size:12px;font-weight:600;color:var(--gray-800);line-height:1.35; }
  .ai-suggestion-box { margin-top:10px;background:white;border:1px solid var(--gray-200);border-radius:8px;padding:10px; }
  .ai-suggestion-title { font-size:11px;font-weight:700;color:var(--gray-700);margin-bottom:5px; }
  .ai-suggestion-text { font-size:12px;color:var(--gray-600);line-height:1.5;white-space:pre-wrap; }
  .ai-loading { color:var(--gray-400);font-size:12px;display:flex;align-items:center;gap:7px; }
  .ai-actions { display:flex;gap:7px;flex-wrap:wrap;margin-top:10px; }
  .sector-chip { display:inline-flex;align-items:center;gap:5px;padding:5px 8px;border:1px solid var(--gray-200);border-radius:20px;background:white;font-size:11px;cursor:pointer; }
  .sector-chip.active { background:var(--red-light);border-color:#E7AAB4;color:var(--red-dark);font-weight:700; }
  .modal-backdrop { position:fixed;inset:0;background:rgba(17,24,39,.52);z-index:9999;display:none;align-items:center;justify-content:center;padding:24px; }
  .modal-backdrop.open { display:flex; }
  .modal { width:min(1120px,96vw);max-height:90vh;overflow:auto;background:white;border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.25); }
  .modal-header { position:sticky;top:0;z-index:2;background:white;display:flex;align-items:flex-start;justify-content:space-between;padding:20px 22px;border-bottom:1px solid var(--gray-200); }
  .modal-title { font-size:18px;font-weight:800;color:var(--gray-900); }
  .modal-sub { font-size:12px;color:var(--gray-500);margin-top:3px; }
  .modal-close { border:none;background:var(--gray-100);width:34px;height:34px;border-radius:8px;cursor:pointer;font-size:18px;color:var(--gray-700); }
  .modal-body { padding:20px 22px; }
  .modal-grid-2 { display:grid;grid-template-columns:1fr 1fr;gap:14px; }
  .modal-grid-3 { display:grid;grid-template-columns:repeat(3,1fr);gap:12px; }
  .detail-card { border:1px solid var(--gray-200);border-radius:10px;padding:14px;background:white; }
  .detail-title { font-size:12px;font-weight:800;margin-bottom:8px;color:var(--gray-800); }
  .detail-label { font-size:10px;text-transform:uppercase;color:var(--gray-400);font-weight:700;margin-bottom:3px; }
  .detail-value { font-size:13px;color:var(--gray-700);line-height:1.5;white-space:pre-wrap; }
  .suggestion-option { border:1px solid var(--gray-200);border-radius:10px;padding:13px;margin-bottom:9px;cursor:pointer; }
  .suggestion-option.selected { border-color:var(--red);background:#FFF7F8;box-shadow:0 0 0 2px rgba(200,16,46,.08); }
  .suggestion-option:hover { border-color:#D88B98; }
  .suggestion-top { display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px; }
  .suggestion-name { font-weight:800;font-size:13px; }
  .confidence { font-size:10px;padding:3px 7px;border-radius:20px;background:var(--gray-100);color:var(--gray-600);font-weight:700; }
  .confidence.high { background:var(--green-light);color:#065F46; }
  .similar-row { border:1px solid var(--gray-200);border-radius:9px;padding:10px;margin-bottom:8px; }
  .similar-row strong { font-size:12px; }
  .similar-meta { font-size:11px;color:var(--gray-500);margin-top:3px; }
  .modal-footer { position:sticky;bottom:0;background:white;border-top:1px solid var(--gray-200);padding:14px 22px;display:flex;justify-content:flex-end;gap:8px; }
  .decision-state { padding:8px 10px;border-radius:8px;background:var(--yellow-light);color:#92400E;font-size:12px;font-weight:700;margin-bottom:12px; }
  .pending-tabs { display:flex;gap:7px;flex-wrap:wrap;margin-bottom:14px; }
  .pending-tab { border:1px solid var(--gray-200);background:white;border-radius:8px;padding:8px 12px;font-size:12px;cursor:pointer;font-weight:600;color:var(--gray-600); }
  .pending-tab.active { background:var(--red);border-color:var(--red);color:white; }
  .pending-row { cursor:pointer; }
  .pending-row:hover { background:#FFF8F9; }
  .analysis-list-row { display:flex;align-items:center;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--gray-100); }
  .analysis-list-row:last-child { border-bottom:none; }
  .muted-note { font-size:11px;color:var(--gray-400); }
  @media (max-width:900px){ .kpi-grid{grid-template-columns:repeat(2,1fr)} .modal-grid-2,.modal-grid-3{grid-template-columns:1fr} }

</style>
</head>
<style>
  .login-screen { position: fixed; inset: 0; background: var(--sidebar-bg); display: flex; align-items: center; justify-content: center; z-index: 9999; }
  .login-box { background: white; border-radius: 16px; padding: 40px; width: 360px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); }
  .login-logo { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
  .login-logo-icon { width: 44px; height: 44px; background: var(--red); border-radius: 10px; display: flex; align-items: center; justify-content: center; }
  .login-logo-icon svg { width: 24px; height: 24px; fill: white; }
  .login-logo-text h2 { font-size: 15px; font-weight: 800; color: var(--gray-900); }
  .login-logo-text p { font-size: 12px; color: var(--gray-400); }
  .login-title { font-size: 22px; font-weight: 800; color: var(--gray-900); margin-bottom: 6px; }
  .login-sub { font-size: 13px; color: var(--gray-400); margin-bottom: 24px; }
  .login-field { margin-bottom: 14px; }
  .login-label { font-size: 12px; font-weight: 600; color: var(--gray-500); margin-bottom: 5px; display: block; }
  .login-input { width: 100%; padding: 10px 12px; border: 1px solid var(--gray-200); border-radius: 8px; font-size: 14px; outline: none; font-family: inherit; }
  .login-input:focus { border-color: var(--red); box-shadow: 0 0 0 3px var(--red-light); }
  .login-btn { width: 100%; padding: 11px; background: var(--red); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 700; cursor: pointer; margin-top: 8px; font-family: inherit; }
  .login-btn:hover { background: var(--red-dark); }
  .login-error { background: #FEE2E2; color: #DC2626; font-size: 12px; padding: 8px 12px; border-radius: 6px; margin-top: 10px; display: none; }
</style>

<div class="login-screen" id="login-screen">
  <div class="login-box">
    <div class="login-logo">
      <div class="login-logo-icon">
        <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
      </div>
      <div class="login-logo-text">
        <h2>Gestão de Manifestações</h2>
        <p>SAC · Grupo Chiacchio</p>
      </div>
    </div>
    <div class="login-title">Bem-vinda de volta</div>
    <div class="login-sub">Entre com suas credenciais para acessar o sistema</div>
    <div class="login-field">
      <label class="login-label">Usuário</label>
      <input class="login-input" type="text" id="login-user" placeholder="seu usuário" autocomplete="username">
    </div>
    <div class="login-field">
      <label class="login-label">Senha</label>
      <input class="login-input" type="password" id="login-pass" placeholder="••••••" autocomplete="current-password" onkeydown="if(event.key==='Enter')doLogin()">
    </div>
    <button class="login-btn" onclick="doLogin()">Entrar</button>
    <div class="login-error" id="login-error">Usuário ou senha incorretos.</div>
  </div>
</div>

<script>
  function doLogin() {
    const user = document.getElementById('login-user').value.trim().toLowerCase();
    const pass = document.getElementById('login-pass').value;
    const users = { 'luiza': '125600' };
    if (users[user] && users[user] === pass) {
      document.getElementById('login-screen').style.display = 'none';
      sessionStorage.setItem('sac-auth', '1');
      sessionStorage.setItem('sac-user', user.charAt(0).toUpperCase() + user.slice(1));
    } else {
      document.getElementById('login-error').style.display = 'block';
    }
  }
  // Checar se já está logado
  if (sessionStorage.getItem('sac-auth') === '1') {
    document.getElementById('login-screen').style.display = 'none';
  }
</script>

<body>

<!-- SIDEBAR -->
<nav class="sidebar">
  <div class="sidebar-logo">
    <div class="sidebar-logo-icon">
      <svg viewBox="0 0 24 24"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>
    </div>
    <h2>Gestão de Manifestações</h2>
    <p>SAC · Grupo Chiacchio</p>
  </div>

  <div class="sidebar-section">Atendimento</div>
  <div class="sidebar-item active" onclick="navigate('visao-geral', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
    Visão Geral
  </div>
  <div class="sidebar-item" onclick="navigate('nova-manifestacao', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    Nova Manifestação
  </div>
  <div class="sidebar-item" onclick="navigate('banco-manifestacoes', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>
    Banco de Manifestações
  </div>

  <div class="sidebar-item" onclick="navigate('analise-inteligente', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 0-4 12.74V18h8v-3.26A7 7 0 0 0 12 2z"/><path d="M9 22h6"/><path d="M9 18h6"/></svg>
    Análise Inteligente
  </div>
  <div class="sidebar-item" onclick="navigate('pendencias', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h12v20H6z"/><path d="M9 6h6M9 10h6M9 14h4"/></svg>
    Pendências
  </div>

  <div class="sidebar-section">Gestão</div>
  <div class="sidebar-item" onclick="navigate('banco-rnc', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
    Banco de RNC
  </div>
  <div class="sidebar-item" onclick="navigate('setores', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 19.07a10 10 0 0 1 0-14.14"/></svg>
    Setores
  </div>

  <div class="sidebar-section">Regras</div>
  <div class="sidebar-item" onclick="navigate('matriz', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18"/></svg>
    Matriz de Tratamento
  </div>
  <div class="sidebar-item" onclick="navigate('base-conhecimento', this)">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
    Base de Conhecimento
  </div>

  <div class="sidebar-bottom">
    <div class="sidebar-link">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
      Painel de satisfação geral
    </div>
    <div class="sidebar-user">
      <div class="sidebar-user-avatar">AN</div>
      <div class="sidebar-user-info">
        <div class="sidebar-user-name">Ana Lima</div>
        <div class="sidebar-user-role">Analista SAC</div>
      </div>
    </div>
  </div>
</nav>

<!-- MAIN CONTENT -->
<main class="main">

  <!-- ===== VISÃO GERAL ===== -->
  <div class="page active" id="page-visao-geral">
    <div class="topbar">
      <div class="breadcrumb">Atendimento / <span>Painel</span></div>
      <div class="page-header">
        <h1 class="page-title">Visão Geral</h1>
        <div class="page-actions">
          <span class="badge-mockup">Dados em tempo real</span>
          <button class="btn btn-primary" onclick="navigate('nova-manifestacao', document.querySelector('[onclick*=nova-manifestacao]'))">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nova manifestação
          </button>
        </div>
      </div>
    </div>
    <div class="content">
      <!-- Filters -->
      <div class="filters">
        <div class="filter-group">
          <button class="filter-btn">Hoje</button>
          <button class="filter-btn">7 dias</button>
          <button class="filter-btn active">30 dias</button>
          <button class="filter-btn">Personalizado</button>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:white;border:1px solid var(--gray-200);border-radius:8px;padding:5px 10px">
          <span style="font-size:12px;color:var(--gray-500)">Empresa</span>
          <select id="filtro-empresa-select" onchange="aplicarFiltros()" style="border:none;font-size:12px;font-weight:600;color:var(--gray-900);outline:none;background:transparent;cursor:pointer">
            <option value="Todas">Todas</option>
          </select>
        </div>
        <div style="display:flex;align-items:center;gap:6px;background:white;border:1px solid var(--gray-200);border-radius:8px;padding:5px 10px">
          <span style="font-size:12px;color:var(--gray-500)">Setor</span>
          <select id="filtro-setor-select" onchange="aplicarFiltros()" style="border:none;font-size:12px;font-weight:600;color:var(--gray-900);outline:none;background:transparent;cursor:pointer">
            <option value="Todos">Todos</option>
          </select>
        </div>
        <a href="https://script.google.com/macros/s/AKfycbxjRAEopqf9DsClRzJFoa28Jq8VSc8KBrpuot8emFF4oxHNZ7nsOqe2hRLjJxh8fjg-/exec" target="_blank" style="display:inline-flex;align-items:center;gap:6px;padding:6px 12px;background:white;border:1px solid var(--gray-200);border-radius:8px;font-size:12px;font-weight:600;color:var(--gray-700);text-decoration:none">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
          Painel de Resultados
        </a>
        <span class="filter-last" id="last-update">Última atualização: --:--</span>
      </div>

      <!-- KPIs -->
      <div class="kpi-grid" id="kpi-grid">
        <div class="kpi-card highlight clickable-card" onclick="abrirDetalhesIndicador('andamento')">
          <div class="kpi-label">Manifestações em andamento</div>
          <div class="kpi-value" id="kpi-andamento">--</div>
          <div class="kpi-delta" id="kpi-andamento-delta">Carregando...</div>
        </div>
        <div class="kpi-card clickable-card" onclick="abrirDetalhesIndicador('sla')">
          <div class="kpi-label">Dentro do prazo de 72h</div>
          <div class="kpi-value" id="kpi-prazo">--%</div>
          <div class="kpi-delta up">↑ carregando</div>
        </div>
        <div class="kpi-card clickable-card" onclick="abrirDetalhesIndicador('atrasadas')">
          <div class="kpi-label">Atrasadas</div>
          <div class="kpi-value" id="kpi-atrasadas">--</div>
          <div class="kpi-delta down">↓ carregando</div>
        </div>
        <div class="kpi-card clickable-card" onclick="abrirDetalhesIndicador('rnc')">
          <div class="kpi-label">RNCs abertas</div>
          <div class="kpi-value" id="kpi-rncs">--</div>
          <div class="kpi-delta">carregando</div>
        </div>
        <div class="kpi-card clickable-card" onclick="abrirDetalhesIndicador('total')">
          <div class="kpi-label">Total de manifestações</div>
          <div class="kpi-value" id="kpi-total">--</div>
          <div class="kpi-delta">no período</div>
        </div>
      </div>

      <!-- Row 2 -->
      <div class="grid-3" style="margin-bottom:16px">
        <!-- Etapas -->
        <div class="section-card">
          <div class="section-title">Manifestações por etapa</div>
          <div class="section-sub">Onde os casos estão agora</div>
          <div id="etapas-list">
            <div class="loading"><div class="spinner"></div> Carregando...</div>
          </div>
        </div>

        <!-- Tipos donut -->
        <div class="section-card">
          <div class="section-title">Por tipo de manifestação</div>
          <div class="section-sub">Reclamação, dúvida, sugestão, elogio</div>
          <div class="donut-wrap" id="donut-wrap">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Procedência -->
        <div class="section-card">
          <div class="section-title">Procedência</div>
          <div class="section-sub" id="proc-sub">Manifestações já decididas</div>
          <div id="proc-content">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Row 3 -->
      <div class="grid-2" style="margin-bottom:16px">
        <!-- Gráfico barras -->
        <div class="section-card">
          <div class="section-title">Novas manifestações por semana</div>
          <div class="section-sub" id="bar-sub">Últimas 12 semanas</div>
          <div id="bar-chart-wrap">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>

        <!-- Pendências por setor -->
        <div class="section-card">
          <div class="section-title">Pendências por setor</div>
          <div class="section-sub">Fichas enviadas aguardando resposta</div>
          <table class="ptable" id="ptable">
            <thead>
              <tr>
                <th>Setor</th>
                <th>Aguardando</th>
                <th>Atrasadas</th>
                <th>Tempo médio</th>
              </tr>
            </thead>
            <tbody id="ptable-body">
              <tr><td colspan="4"><div class="loading"><div class="spinner"></div></div></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Bloco por empresa + Top motivos -->
      <div class="grid-2" style="margin-top:16px">
        <div class="section-card">
          <div class="section-title" style="margin-bottom:4px">Desempenho por empresa</div>
          <div class="section-sub" style="margin-bottom:14px">Visão comparativa operacional</div>
          <div id="empresa-cards" style="display:flex;gap:10px;flex-wrap:wrap">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-title" style="margin-bottom:4px">Principais motivos</div>
          <div class="section-sub" style="margin-bottom:14px">Motivos mais frequentes nas manifestações</div>
          <div id="top-motivos">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
      </div>

      <!-- Comparativo IA x setores -->
      <div class="grid-2" style="margin-top:16px">
        <div class="section-card">
          <div class="section-title">Desempenho da ferramenta × setores</div>
          <div class="section-sub">Casos analisados pela ferramenta, decisão humana e SLA por setor</div>
          <div id="comparativo-setores">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-title">Ações dentro da ferramenta</div>
          <div class="section-sub">O que o sistema registrou e executou nos casos</div>
          <div class="kpi-grid" style="grid-template-columns:repeat(2,1fr);margin:0;gap:8px" id="acoes-ferramenta">
            <div class="kpi-card clickable-card" onclick="abrirDetalhesAcao('registros')"><div class="kpi-label">Registros criados</div><div class="kpi-value" id="acao-registros">—</div><div class="kpi-delta">abrir detalhes</div></div>
            <div class="kpi-card clickable-card" onclick="abrirDetalhesAcao('analises')"><div class="kpi-label">Análises inteligentes</div><div class="kpi-value" id="acao-analises">—</div><div class="kpi-delta">abrir detalhes</div></div>
            <div class="kpi-card clickable-card" onclick="abrirDetalhesAcao('decisoes')"><div class="kpi-label">Decisões do analista</div><div class="kpi-value" id="acao-decisoes">—</div><div class="kpi-delta">abrir detalhes</div></div>
            <div class="kpi-card clickable-card" onclick="abrirDetalhesAcao('encaminhamentos')"><div class="kpi-label">Encaminhamentos</div><div class="kpi-value" id="acao-encaminhamentos">—</div><div class="kpi-delta">abrir detalhes</div></div>
            <div class="kpi-card clickable-card" onclick="abrirDetalhesAcao('devolutivas')" style="grid-column:1/-1"><div class="kpi-label">Devolutivas</div><div class="kpi-value" id="acao-devolutivas">—</div><div class="kpi-delta">abrir detalhes</div></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== NOVA MANIFESTAÇÃO ===== -->
  <div class="page" id="page-nova-manifestacao">
    <div class="topbar">
      <div class="breadcrumb">Atendimento / <span>Nova manifestação</span></div>
      <div class="page-header">
        <h1 class="page-title">Nova Manifestação</h1>
        <span class="badge-mockup">Dados em tempo real</span>
      </div>
    </div>
    <div class="content">
      <!-- Stepper -->
      <div class="stepper">
        <div class="step">
          <div class="step-num active">1</div>
          <div class="step-label active">Registro</div>
        </div>
        <div class="step-line"></div>
        <div class="step"><div class="step-num todo">2</div><div class="step-label todo">Análise Inteligente</div></div>
        <div class="step-line"></div>
        <div class="step"><div class="step-num todo">3</div><div class="step-label todo">Decisão do Analista</div></div>
        <div class="step-line"></div>
        <div class="step"><div class="step-num todo">4</div><div class="step-label todo">Setores</div></div>
        <div class="step-line"></div>
        <div class="step"><div class="step-num todo">5</div><div class="step-label todo">Devolutiva e Encerramento</div></div>
      </div>

      <div class="page-layout">
        <div>
          <!-- Seção 1 -->
          <div class="form-section">
            <div class="form-section-title">
              <div class="form-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
              <div class="form-section-name">1. Dados do Registro SAC</div>
            </div>
            <div class="form-section-desc">Preenchidos automaticamente, exceto o canal</div>
            <div class="form-row cols-4">
              <div class="form-group">
                <label class="form-label">Data do registro</label>
                <input class="form-input" readonly id="nm-data" value="">
              </div>
              <div class="form-group">
                <label class="form-label">Nº da reclamação</label>
                <input class="form-input" readonly id="nm-num" value="...">
              </div>
              <div class="form-group">
                <label class="form-label">Setor</label>
                <input class="form-input" readonly value="SAC">
              </div>
              <div class="form-group">
                <label class="form-label">Atendente</label>
                <input class="form-input" readonly value="Ana Lima">
              </div>
            </div>
            <div class="form-group">
              <label class="form-label" style="margin-bottom:6px">Canal de atendimento</label>
              <div class="canal-btns">
                <button class="canal-btn" onclick="selectCanal(this)">Telefone</button>
                <button class="canal-btn active" onclick="selectCanal(this)">WhatsApp</button>
                <button class="canal-btn" onclick="selectCanal(this)">E-mail</button>
                <button class="canal-btn" onclick="selectCanal(this)">Presencial</button>
                <button class="canal-btn" onclick="selectCanal(this)">Pesquisa de Satisfação</button>
                <button class="canal-btn" onclick="selectCanal(this)">Outro</button>
              </div>
            </div>
          </div>

          <!-- Seção 2 -->
          <div class="form-section">
            <div class="form-section-title">
              <div class="form-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></div>
              <div class="form-section-name">2. Dados do Cliente</div>
            </div>
            <div class="form-section-desc">Digite o CNPJ para buscar no histórico</div>
            <div class="form-row" style="display:flex;gap:10px;margin-bottom:12px">
              <div class="form-group" style="flex:1">
                <label class="form-label">CNPJ</label>
                <input class="form-input" placeholder="00.000.000/0001-00" id="nm-cnpj">
              </div>
              <div style="padding-top:18px">
                <button class="btn btn-secondary" onclick="buscarCliente()">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                  Buscar cliente
                </button>
              </div>
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">Nome do cliente</label>
                <input class="form-input" placeholder="[Nome do contato]" id="nm-nome">
              </div>
              <div class="form-group">
                <label class="form-label">Empresa / Razão social</label>
                <input class="form-input" placeholder="Empresa Exemplo Ltda." id="nm-empresa">
              </div>
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">Telefone / WhatsApp</label>
                <input class="form-input" placeholder="(77) 90000-0000" id="nm-tel">
              </div>
              <div class="form-group">
                <label class="form-label">E-mail</label>
                <input class="form-input" placeholder="contato@exemplo.com.br" id="nm-email">
              </div>
            </div>
            <div class="form-row cols-2">
              <div class="form-group">
                <label class="form-label">Empresa reclamada</label>
                <select class="form-input" id="nm-empresa-reclamada">
                  <option value="CHIACCHIO EMBALAGENS">CHIACCHIO EMBALAGENS</option>
                  <option value="PLASCHIO">PLASCHIO</option>
                  <option value="TUBAHIA">TUBAHIA</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label">Valor da reclamação</label>
                <input class="form-input" type="number" step="0.01" min="0" placeholder="0,00" id="nm-valor-top">
              </div>
            </div>
          </div>

          <!-- Seção 3 -->
          <div class="form-section">
            <div class="form-section-title">
              <div class="form-section-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg></div>
              <div class="form-section-name">3. Informações da Manifestação</div>
            </div>
            <div class="form-section-desc">Procedência e justificativa são definidas na etapa de decisão</div>
            <div class="form-group" style="margin-bottom:12px">
              <label class="form-label" style="margin-bottom:6px">Tipo de manifestação</label>
              <div class="tipo-btns">
                <button class="canal-btn active" onclick="selectTipo(this)">Reclamação</button>
                <button class="canal-btn" onclick="selectTipo(this)">Dúvida</button>
                <button class="canal-btn" onclick="selectTipo(this)">Sugestão</button>
                <button class="canal-btn" onclick="selectTipo(this)">Elogio</button>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label">Descrição detalhada da manifestação</label>
              <textarea class="form-textarea" placeholder="Descreva detalhadamente a manifestação do cliente..." id="nm-descricao"></textarea>
            </div>
            <div id="questionario-tipo"></div>
          </div>

          <!-- Seção 4 -->
          <div class="form-section">
            <div class="form-section-title">
              <div class="form-section-icon" style="background:#FEF3C7"><svg viewBox="0 0 24 24" fill="none" stroke="#D97706" stroke-width="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>
              <div class="form-section-name">4. Informações do Produto</div>
            </div>
            <div class="form-section-desc">Quando aplicável</div>
            <div class="form-row cols-3">
              <div class="form-group">
                <label class="form-label">Produto</label>
                <input class="form-input" placeholder="[Produto]" id="nm-produto">
              </div>
              <div class="form-group">
                <label class="form-label">Lote</label>
                <input class="form-input" placeholder="L-0000" id="nm-lote">
              </div>
              <div class="form-group">
                <label class="form-label">NFe</label>
                <input class="form-input" placeholder="000000" id="nm-nfe">
              </div>
            </div>
            <div class="form-row cols-3">
              <div class="form-group">
                <label class="form-label">Valor reclamado</label>
                <input class="form-input" type="number" step="0.01" min="0" placeholder="R$ 0,00" id="nm-valor">
              </div>
              <div class="form-group">
                <label class="form-label">Kg total do pedido reclamado</label>
                <input class="form-input" type="number" step="0.01" min="0" placeholder="0,00 kg" id="nm-kg-total">
              </div>
              <div class="form-group">
                <label class="form-label">Kg devolvidos</label>
                <input class="form-input" type="number" step="0.01" min="0" placeholder="Quando aplicável" id="nm-kg-devolvidos">
              </div>
            </div>
          </div>
        </div>

        <!-- ASIDE -->
        <div class="aside">
          <div class="section-card ai-live-card" id="ai-live-card">
            <div class="ai-live-head">
              <div>
                <div class="section-title" style="margin-bottom:2px">Análise Inteligente</div>
                <div class="section-sub" style="margin-bottom:0">Sugestões enquanto você registra a manifestação</div>
              </div>
              <span class="ai-live-badge"><span class="ai-live-dot"></span>IA</span>
            </div>
            <div id="ai-live-content">
              <div class="ai-loading">Digite a manifestação para iniciar a análise.</div>
            </div>
          </div>

          <div class="section-card">
            <div class="section-title" style="margin-bottom:12px">
              <svg style="display:inline;width:14px;height:14px;margin-right:6px;vertical-align:-2px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              Resumo da ficha
            </div>
            <div class="sidebar-resumo">
              <div class="resumo-item">
                <div class="resumo-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
                <div><div class="resumo-label">1. Registro SAC</div></div>
              </div>
              <div class="resumo-item">
                <div class="resumo-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
                <div><div class="resumo-label">2. Cliente</div></div>
              </div>
              <div class="resumo-item">
                <div class="resumo-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
                <div><div class="resumo-label">3. Manifestação</div></div>
              </div>
              <div class="resumo-item">
                <div class="resumo-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg></div>
                <div><div class="resumo-label">4. Produto</div></div>
              </div>
              <div class="resumo-item">
                <div class="resumo-check pending"></div>
                <div><div class="resumo-label">5. Encaminhamento</div><div class="resumo-sub">Preenchido ao acionar os setores</div></div>
              </div>
              <div class="resumo-item">
                <div class="resumo-check pending"></div>
                <div><div class="resumo-label">6. Resposta do setor</div><div class="resumo-sub">Preenchida por cada setor</div></div>
              </div>
              <div class="resumo-item">
                <div class="resumo-check pending"></div>
                <div><div class="resumo-label">7. Validação do SAC</div><div class="resumo-sub">Preenchida ao encerrar</div></div>
              </div>
            </div>
          </div>

          <div class="section-card">
            <div class="section-title" style="margin-bottom:8px;font-size:13px">
              <svg style="display:inline;width:13px;height:13px;margin-right:5px;vertical-align:-1px" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
              Verificação automática
            </div>
            <div class="alert-box green" style="font-size:11px;margin-bottom:8px">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>
              Nenhuma manifestação aberta com o mesmo pedido ou NFe.
            </div>
            <div style="font-size:11px;color:var(--gray-400)">O sistema compara cliente, NFe e lote com casos dos últimos 90 dias.</div>
          </div>

          <button class="btn btn-primary" style="width:100%;justify-content:center" onclick="registrarManifestacao()">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Registrar e enviar para análise
          </button>
          <button class="btn btn-secondary" style="width:100%;justify-content:center;margin-top:6px">Salvar rascunho</button>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== BANCO DE MANIFESTAÇÕES ===== -->
  <div class="page" id="page-banco-manifestacoes">
    <div class="topbar">
      <div class="breadcrumb">Atendimento / <span>Banco de Manifestações</span></div>
      <div class="page-header">
        <h1 class="page-title">Banco de Manifestações</h1>
        <div class="page-actions">
          <button class="btn btn-secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar
          </button>
          <button class="btn btn-primary" onclick="navigate('nova-manifestacao', document.querySelector('[onclick*=nova-manifestacao]'))">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nova manifestação
          </button>
        </div>
      </div>
    </div>
    <div class="content">
      <!-- Search + filters -->
      <div class="card card-pad" style="margin-bottom:16px">
        <div style="display:flex;gap:10px;margin-bottom:10px">
          <div class="search-wrap">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="search-input" placeholder="Buscar por protocolo, cliente, CNPJ, NFe ou lote" id="banco-search" oninput="filtrarBanco()">
          </div>
        </div>
        <div class="filters" style="margin-bottom:0">
          <div class="filter-select"><span>Status</span><strong>Todos</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
          <div class="filter-select"><span>Tipo</span><strong>Todos</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
          <div class="filter-select"><span>Setor</span><strong>Todos</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
          <div class="filter-select"><span>Empresa</span><strong>Todas</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
          <div class="filter-select"><span>Período</span><strong>30 dias</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
          <div class="filter-select"><span>Procedência</span><strong>Todas</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="tabs-bar" id="banco-tabs">
        <button class="tab-btn active" onclick="filterBancoTab(this, 'todas')">Todas · <span id="tab-total">--</span></button>
        <button class="tab-btn" onclick="filterBancoTab(this, 'atrasadas')">Atrasadas · <span id="tab-atrasadas">--</span></button>
        <button class="tab-btn" onclick="filterBancoTab(this, 'aguardando')">Aguardando setor · <span id="tab-aguardando">--</span></button>
        <button class="tab-btn" onclick="filterBancoTab(this, 'encerradas')">Encerradas · <span id="tab-encerradas">--</span></button>
      </div>

      <!-- Table -->
      <div class="card">
        <table class="banco-table" id="banco-table">
          <thead>
            <tr>
              <th>Nº / data</th>
              <th>Cliente</th>
              <th>Tipo</th>
              <th>Setores acionados</th>
              <th>Etapa</th>
              <th>Prazo</th>
              <th>Procedência</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="banco-body">
            <tr><td colspan="8"><div class="loading"><div class="spinner"></div> Carregando manifestações...</div></td></tr>
          </tbody>
        </table>
        <div class="pagination" style="padding:12px 16px;border-top:1px solid var(--gray-100)">
          <div class="pagination-info" id="banco-info">Mostrando 1–10 de --</div>
          <div class="pagination-btns">
            <button class="page-btn">←</button>
            <button class="page-btn active">1</button>
            <button class="page-btn">2</button>
            <button class="page-btn">3</button>
            <button class="page-btn">→</button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== ANÁLISE INTELIGENTE ===== -->
  <div class="page" id="page-analise-inteligente">
    <div class="topbar">
      <div class="breadcrumb">Atendimento / <span>Análise Inteligente</span></div>
      <div class="page-header">
        <h1 class="page-title">Análise Inteligente</h1>
        <span class="badge-mockup">Classificação · similares · tratativa · devolutiva</span>
      </div>
    </div>
    <div class="content">
      <div class="card card-pad">
        <div class="section-title">Casos aguardando análise/decisão</div>
        <div class="section-sub">Selecione um caso para abrir a análise completa.</div>
        <div id="analise-lista"><div class="loading"><div class="spinner"></div> Carregando...</div></div>
      </div>
    </div>
  </div>

  <!-- ===== PENDÊNCIAS ===== -->
  <div class="page" id="page-pendencias">
    <div class="topbar">
      <div class="breadcrumb">Atendimento / <span>Pendências</span></div>
      <div class="page-header">
        <h1 class="page-title">Pendências</h1>
        <span class="badge-mockup">Acompanhe o fluxo de cada manifestação</span>
      </div>
    </div>
    <div class="content">
      <div class="pending-tabs" id="pending-tabs">
        <button class="pending-tab active" onclick="filtrarPendencias('PENDENTE',this)">Pendentes</button>
        <button class="pending-tab" onclick="filtrarPendencias('APROVADA',this)">Aprovadas</button>
        <button class="pending-tab" onclick="filtrarPendencias('REJEITADA',this)">Rejeitadas</button>
        <button class="pending-tab" onclick="filtrarPendencias('TRATAMENTO',this)">Em tratamento</button>
        <button class="pending-tab" onclick="filtrarPendencias('ENCERRADA',this)">Encerradas</button>
      </div>
      <div class="card">
        <table class="banco-table">
          <thead><tr><th>Nº / data</th><th>Cliente</th><th>Tipo</th><th>Setores</th><th>Status</th><th>Prazo</th><th></th></tr></thead>
          <tbody id="pendencias-body"><tr><td colspan="7"><div class="loading"><div class="spinner"></div></div></td></tr></tbody>
        </table>
      </div>
    </div>
  </div>

  <!-- ===== BANCO DE RNC ===== -->
  <div class="page" id="page-banco-rnc">
    <div class="topbar">
      <div class="breadcrumb">Gestão / <span>Banco de RNC</span></div>
      <div class="page-header">
        <h1 class="page-title">Banco de RNC</h1>
        <div class="page-actions">
          <button class="btn btn-secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Exportar
          </button>
          <button class="btn btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nova RNC
          </button>
        </div>
      </div>
    </div>
    <div class="content">
      <!-- KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card highlight">
          <div class="kpi-label">RNCs abertas</div>
          <div class="kpi-value" id="rnc-abertas">--</div>
          <div class="kpi-delta">carregando</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Vencendo em 7 dias</div>
          <div class="kpi-value" id="rnc-vencendo">--</div>
          <div class="kpi-delta">Ação corretiva perto do prazo</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Em verificação de eficácia</div>
          <div class="kpi-value">3</div>
          <div class="kpi-delta">Aguardando conferência</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Encerradas no mês</div>
          <div class="kpi-value">9</div>
          <div class="kpi-delta up">↑ +1 vs. mês anterior</div>
        </div>
      </div>

      <!-- Filters -->
      <div class="card card-pad" style="margin-bottom:16px;display:flex;gap:10px;align-items:center">
        <div class="search-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="search-input" placeholder="Buscar por nº da RNC, causa raiz ou responsável">
        </div>
        <div class="filter-select"><span>Setor</span><strong>Todos</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
        <div class="filter-select"><span>Status</span><strong>Todos</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
        <div class="filter-select"><span>Prazo</span><strong>Todos</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      </div>

      <!-- Table -->
      <div class="card" style="margin-bottom:16px">
        <table class="rnc-table">
          <thead>
            <tr>
              <th>Nº RNC</th><th>Origem</th><th>Setor</th><th>Causa raiz e ação corretiva ou preventiva</th><th>Responsável</th><th>Prazo</th><th>Status</th>
            </tr>
          </thead>
          <tbody id="rnc-body">
            <tr><td colspan="7"><div class="loading"><div class="spinner"></div> Carregando RNCs...</div></td></tr>
          </tbody>
        </table>
        <div class="pagination" style="padding:12px 16px;border-top:1px solid var(--gray-100)">
          <div class="pagination-info">Mostrando 1–8 de 21</div>
          <div class="pagination-btns">
            <button class="page-btn">←</button>
            <button class="page-btn active">1</button>
            <button class="page-btn">2</button>
            <button class="page-btn">3</button>
            <button class="page-btn">→</button>
          </div>
        </div>
      </div>

      <!-- Bottom grid -->
      <div class="grid-2">
        <div class="section-card">
          <div class="section-title">Causas recorrentes</div>
          <div class="section-sub">Mesma causa em mais de uma RNC nos últimos 90 dias</div>
          <div id="causas-list">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-title">Abertas por setor</div>
          <div class="section-sub" id="rnc-abertas-sub">-- RNCs abertas</div>
          <div id="rnc-setor-list">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== SETORES ===== -->
  <div class="page" id="page-setores">
    <div class="topbar">
      <div class="breadcrumb">Gestão / <span>Setores</span></div>
      <div class="page-header">
        <h1 class="page-title">Setores</h1>
        <div class="filter-select"><span>Período</span><strong>30 dias</strong><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"/></svg></div>
      </div>
    </div>
    <div class="content">
      <div class="setores-grid" id="setores-grid">
        <div class="loading" style="grid-column:1/-1"><div class="spinner"></div> Carregando setores...</div>
      </div>

      <!-- Heatmap -->
      <div class="section-card" style="margin-bottom:16px">
        <div class="section-title">Mapa de calor: setor × tema</div>
        <div class="section-sub">Quantas manifestações cada setor recebeu, por tema</div>
        <div style="overflow-x:auto">
          <table class="heatmap">
            <thead>
              <tr>
                <th></th>
                <th>Avaria no transporte</th>
                <th>Atraso na entrega</th>
                <th>Diverg. de NF/cobrança</th>
                <th>Qualidade do produto</th>
                <th>Cotação e preço</th>
                <th>Atendimento</th>
                <th>Outros</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody id="heatmap-body">
              <tr><td colspan="9"><div class="loading"><div class="spinner"></div></div></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="section-card">
          <div class="section-title">Tempo médio de resposta</div>
          <div class="section-sub">Comparado ao prazo de 72h (barra cheia)</div>
          <div id="tempo-list">
            <div class="loading"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-title">Acionados sem responsabilidade</div>
          <div class="section-sub">Setores que responderam "Não" à pergunta de responsabilidade</div>
          <div id="sem-resp-list">
            <div class="loading"><div class="spinner"></div></div>
          </div>
          <div style="margin-top:12px">
            <a href="#" style="color:var(--red);font-size:12px;font-weight:600">Percentual alto pede revisão na Matriz de Tratamento</a>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== MATRIZ DE TRATAMENTO ===== -->
  <div class="page" id="page-matriz">
    <div class="topbar">
      <div class="breadcrumb">Regras / <span>Matriz de Tratamento</span></div>
      <div class="page-header">
        <h1 class="page-title">Matriz de Tratamento</h1>
        <div class="page-actions">
          <button class="btn btn-secondary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            Histórico de versões
          </button>
          <button class="btn btn-primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Nova regra
          </button>
        </div>
      </div>
    </div>
    <div class="content">
      <div class="alert-box blue" style="margin-bottom:16px">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 9h6M9 12h6M9 15h4"/></svg>
        A IA consulta esta matriz na análise, a decisão do analista já vem pré-preenchida e o acionamento sabe quem chamar. Cada mudança gera uma nova versão.
      </div>

      <div class="card" style="margin-bottom:16px">
        <div style="padding:16px 20px;border-bottom:1px solid var(--gray-100)">
          <div class="section-title">Regras de tratamento por tema</div>
          <div class="section-sub" style="margin-bottom:0">Uma linha por tipo de manifestação</div>
        </div>
        <table class="matriz-table">
          <thead>
            <tr>
              <th>Tema</th><th>Setor principal</th><th>Setores de apoio</th><th>Prazo</th><th>Prioridade</th><th>Gera RNC</th><th>Aprovação</th><th>Follow-up</th><th></th>
            </tr>
          </thead>
          <tbody id="matriz-body">
            <tr><td colspan="9"><div class="loading"><div class="spinner"></div> Carregando matriz...</div></td></tr>
          </tbody>
        </table>
      </div>

      <div class="grid-2">
        <div class="section-card">
          <div class="section-title">Onde a matriz é usada</div>
          <div style="display:flex;flex-direction:column;gap:12px;margin-top:12px">
            <div style="display:flex;gap:10px;align-items:flex-start">
              <div style="width:22px;height:22px;background:var(--red);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;flex-shrink:0">1</div>
              <div><div style="font-weight:600;font-size:13px">Análise Inteligente</div><div style="font-size:12px;color:var(--gray-400);margin-top:2px">A IA sugere tema, setores, prazo e se gera RNC a partir destas regras.</div></div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start">
              <div style="width:22px;height:22px;background:var(--red);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;flex-shrink:0">2</div>
              <div><div style="font-weight:600;font-size:13px">Decisão do Analista</div><div style="font-size:12px;color:var(--gray-400);margin-top:2px">Os campos já chegam pré-preenchidos; o analista só confirma ou ajusta.</div></div>
            </div>
            <div style="display:flex;gap:10px;align-items:flex-start">
              <div style="width:22px;height:22px;background:var(--red);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:11px;font-weight:700;flex-shrink:0">3</div>
              <div><div style="font-weight:600;font-size:13px">Acionamento dos Setores</div><div style="font-size:12px;color:var(--gray-400);margin-top:2px">O sistema envia a ficha ao setor principal e aos de apoio, com o prazo definido.</div></div>
            </div>
          </div>
        </div>
        <div class="section-card">
          <div class="section-title">Versões</div>
          <div class="section-sub">Histórico de alterações</div>
          <div style="display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;gap:8px;align-items:flex-start">
              <span style="background:var(--red);color:white;font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;flex-shrink:0">v1.4</span>
              <div><div style="font-size:12px;font-weight:600">Prazo de Cotação e preço passou para 48h</div><div style="font-size:11px;color:var(--gray-400)">18/09/2026 · [Nome]</div></div>
            </div>
            <div style="display:flex;gap:8px;align-items:flex-start">
              <span style="background:var(--gray-200);color:var(--gray-600);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;flex-shrink:0">v1.3</span>
              <div><div style="font-size:12px;font-weight:600">Qualidade incluída como apoio em Avaria</div><div style="font-size:11px;color:var(--gray-400)">02/09/2026 · [Nome]</div></div>
            </div>
            <div style="display:flex;gap:8px;align-items:flex-start">
              <span style="background:var(--gray-200);color:var(--gray-600);font-size:10px;font-weight:700;padding:2px 6px;border-radius:4px;flex-shrink:0">v1.2</span>
              <div><div style="font-size:12px;font-weight:600">Novo tema: Divergência de NF ou cobrança</div><div style="font-size:11px;color:var(--gray-400)">11/08/2026 · [Nome]</div></div>
            </div>
          </div>
          <div class="alert-box yellow" style="margin-top:12px;font-size:11px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            2 regras estão sem revisão há mais de 6 meses.
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- ===== BASE DE CONHECIMENTO ===== -->
  <div class="page" id="page-base-conhecimento">
    <div class="topbar">
      <div class="breadcrumb">Regras / <span>Base de Conhecimento</span></div>
      <div class="page-header">
        <h1 class="page-title">Base de Conhecimento</h1>
        <button class="btn btn-primary">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          Novo documento
        </button>
      </div>
    </div>
    <div class="content" style="padding-bottom:0">
      <div class="bc-layout" style="height:calc(100vh - 140px)">
        <!-- BC Sidebar -->
        <div class="bc-sidebar">
          <div class="bc-sidebar-section">Setor</div>
          <div class="bc-sidebar-item active"><span>Todos</span><span class="bc-sidebar-count" id="bc-total">--</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('setor','Logística',this)"><span>Logística</span><span class="bc-sidebar-count">9</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('setor','Qualidade',this)"><span>Qualidade</span><span class="bc-sidebar-count">14</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('setor','Comercial',this)"><span>Comercial</span><span class="bc-sidebar-count">8</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('setor','Financeiro',this)"><span>Financeiro</span><span class="bc-sidebar-count">6</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('setor','Outros',this)"><span>Outros</span><span class="bc-sidebar-count">9</span></div>

          <div class="bc-sidebar-section">Tipo</div>
          <div class="bc-sidebar-item" onclick="filterBC('tipo','Política',this)"><span>Política</span><span class="bc-sidebar-count">12</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('tipo','Procedimento',this)"><span>Procedimento</span><span class="bc-sidebar-count">14</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('tipo','Resposta-modelo',this)"><span>Resposta-modelo</span><span class="bc-sidebar-count">11</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('tipo','FAQ',this)"><span>FAQ</span><span class="bc-sidebar-count">6</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('tipo','Caso exemplar',this)"><span>Caso exemplar</span><span class="bc-sidebar-count">3</span></div>

          <div class="bc-sidebar-section">Status</div>
          <div class="bc-sidebar-item" onclick="filterBC('status','Vigente',this)"><span>Vigente</span><span class="bc-sidebar-count">39</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('status','Revisão vencida',this)"><span>Revisão vencida</span><span class="bc-sidebar-count">4</span></div>
          <div class="bc-sidebar-item" onclick="filterBC('status','Rascunho',this)"><span>Rascunho</span><span class="bc-sidebar-count">3</span></div>
        </div>

        <!-- BC List -->
        <div class="bc-list" id="bc-list">
          <div class="loading"><div class="spinner"></div> Carregando base...</div>
        </div>

        <!-- BC Detail -->
        <div class="bc-detail" id="bc-detail">
          <div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:8px;color:var(--gray-300)">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
            <span style="font-size:13px">Selecione um documento</span>
          </div>
        </div>
      </div>
    </div>
  </div>

</main>

<!-- ===== MODAIS OPERACIONAIS ===== -->
<div class="modal-backdrop" id="modal-detalhes">
  <div class="modal">
    <div class="modal-header"><div><div class="modal-title" id="detalhes-title">Detalhes</div><div class="modal-sub" id="detalhes-sub"></div></div><button class="modal-close" onclick="fecharModal('modal-detalhes')">×</button></div>
    <div class="modal-body" id="detalhes-body"></div>
    <div class="modal-footer"><button class="btn btn-secondary" onclick="fecharModal('modal-detalhes')">Fechar</button><button class="btn btn-primary" id="detalhes-go" style="display:none">Ir para os casos</button></div>
  </div>
</div>

<div class="modal-backdrop" id="modal-analise">
  <div class="modal">
    <div class="modal-header"><div><div class="modal-title">Análise Inteligente</div><div class="modal-sub" id="analise-modal-sub">—</div></div><button class="modal-close" onclick="fecharModal('modal-analise')">×</button></div>
    <div class="modal-body" id="analise-modal-body"><div class="loading"><div class="spinner"></div> Analisando...</div></div>
    <div class="modal-footer" id="analise-modal-footer"></div>
  </div>
</div>

<script>
const API = 'https://assistente-sac-gpchiacchio.vercel.app';

// ===== NAVEGAÇÃO =====
function navigate(page, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  if (el) el.classList.add('active');
}

// ===== HELPERS =====
function fmtDate(d) {
  if (!d) return '--';
  if (typeof d === 'number') { const dt=new Date((d-25569)*86400*1000); return isNaN(dt)?'--':dt.toLocaleDateString('pt-BR'); }
  const raw=String(d).trim();
  const br=raw.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/);
  if(br){const dt=new Date(Number(br[3]),Number(br[2])-1,Number(br[1]),Number(br[4]||0),Number(br[5]||0),Number(br[6]||0));return isNaN(dt)?'--':dt.toLocaleDateString('pt-BR');}
  const dt=new Date(raw); return isNaN(dt)?'--':dt.toLocaleDateString('pt-BR');
}

function prazoClass(status) {
  if (!status) return '';
  const s = status.toUpperCase();
  if (s.includes('ATRASO') || s.includes('ATRASAD')) return 'atrasado';
  if (s.includes('VENCE') || s.includes('PENDENTE')) return 'vence';
  return 'ok';
}

function etapaClass(etapa) {
  if (!etapa) return 'registro';
  const e = etapa.toUpperCase();
  if (e.includes('ANÁLISE') || e.includes('ANALISE')) return 'decisao';
  if (e.includes('SETOR') || e.includes('ENCAMINH')) return 'setores';
  if (e.includes('DEVOLUTIVA') || e.includes('ENCERR') || e.includes('FINALIZ')) return 'encerrada';
  if (e.includes('DECISÃO') || e.includes('DECISAO')) return 'decisao';
  return 'registro';
}

function getEtapaLabel(status) {
  if (!status) return 'Registro';
  const s = status.toUpperCase();
  if (s.includes('ANÁLISE') || s.includes('ANALISE')) return 'Análise';
  if (s.includes('SETOR')) return 'Setores';
  if (s.includes('FINALIZ') || s.includes('ENCERR') || s.includes('CONCLUÍD')) return 'Encerrada';
  if (s.includes('ABERTO') || s.includes('ABERTA')) return 'Em análise';
  return 'Registro';
}

function abrirDetalhesEmpresa(emp){
  const d=(_dashData.recs||[]).filter(x=>String(x.Empresa||'')===String(emp));document.getElementById('detalhes-title').textContent='Desempenho · '+emp;document.getElementById('detalhes-sub').textContent='Clique em “Ir para os casos” para abrir o banco filtrado.';document.getElementById('detalhes-body').innerHTML=`<div class="modal-grid-3"><div class="detail-card"><div class="detail-label">Manifestações</div><div class="kpi-value" style="font-size:24px">${d.length}</div></div><div class="detail-card"><div class="detail-label">Encerradas</div><div class="kpi-value" style="font-size:24px">${d.filter(x=>/FINALIZ|CONCLUÍD|ENCERR/i.test(String(x.Status||x['Situação Final']||''))).length}</div></div><div class="detail-card"><div class="detail-label">SLA</div><div class="kpi-value" style="font-size:24px">${(()=>{const a=d.filter(x=>x['Dentro do prazo? ']||x['Dentro do prazo?']);return a.length?Math.round(a.filter(x=>/^SIM$/i.test(String(x['Dentro do prazo? ']||x['Dentro do prazo?']))).length/a.length*100)+'%':'—'})()}</div></div></div>`;const go=document.getElementById('detalhes-go');go.style.display='inline-flex';go.textContent='Abrir banco';go.onclick=()=>{fecharModal('modal-detalhes');document.getElementById('banco-search').value=emp;navigate('banco-manifestacoes',document.querySelector('[onclick*=banco-manifestacoes]'));loadBancoManifestacoes()};document.getElementById('modal-detalhes').classList.add('open')}

// ===== MODAIS / DETALHES =====
function fecharModal(id){document.getElementById(id)?.classList.remove('open')}
document.addEventListener('click',e=>{if(e.target.classList.contains('modal-backdrop'))e.target.classList.remove('open')});
function abrirDetalhesIndicador(tipo){
  const d=calcDashboard(_dashData.mans,_dashData.recs,_dashFiltroEmpresa,_dashFiltroSetor);
  let title='',value='',desc='',cases=[];
  const all=[..._dashData.mans.map(x=>({...x,_fonte:'Ferramenta'})),..._dashData.recs.map(x=>({...x,_fonte:'Histórico'}))];
  if(tipo==='andamento'){title='Manifestações em andamento';value=d.emAndamento;desc='Casos ainda não encerrados.';cases=_dashData.mans.filter(m=>!['FINALIZ','ENCERR','CONCLUÍD'].some(k=>statusNorm(m).includes(k)));}
  if(tipo==='sla'){title='Dentro do prazo de 72h';value=d.slaPercent+'%';desc=`Dentro: ${d.dentroPrazo} · Fora: ${d.foraPrazo}`;cases=_dashData.recs.filter(x=>/^SIM$/i.test(String(x['Dentro do prazo? ']||x['Dentro do prazo?']||'')));}
  if(tipo==='atrasadas'){title='Atrasadas';value=d.foraPrazo;desc='Casos fora do prazo registrado na fonte.';cases=_dashData.recs.filter(x=>/^(NÃO|NAO)$/i.test(String(x['Dentro do prazo? ']||x['Dentro do prazo?']||'')));}
  if(tipo==='rnc'){title='RNCs abertas';value=d.rncs;desc='Manifestações com RNC registrada/sugerida.';cases=_dashData.mans.filter(m=>m.ID_RNC||m.RNC_SUGERIDO==='SIM');}
  if(tipo==='total'){title='Total de manifestações';value=d.total;desc='Soma das manifestações da ferramenta e registros históricos no filtro atual.';cases=all;}
  const lista=cases.slice(0,10).map(m=>`<div class="analysis-list-row"><div><strong>${m.ID_MANIFESTACAO||m.ID_HISTORICO||'Registro histórico'}</strong><div class="muted-note">${nomeCliente(m)} · ${m.TIPO||m.TIPO_CONFIRMADO||m['Motivo da Reclamação']||'Reclamação'} · ${fmtDate(dataManifestacao(m))}</div></div><button class="btn btn-secondary" onclick="${m.ID_MANIFESTACAO?`abrirManifestacao('${String(m.ID_MANIFESTACAO).replace(/'/g,"\\'")}')`:`abrirDetalhesHistorico('${String(m.ID_HISTORICO||'').replace(/'/g,"\\'")}')`}">Abrir</button></div>`).join('');
  document.getElementById('detalhes-title').textContent=title;document.getElementById('detalhes-sub').textContent=`Empresa: ${_dashFiltroEmpresa} · Setor: ${_dashFiltroSetor}`;
  document.getElementById('detalhes-body').innerHTML=`<div class="modal-grid-2"><div class="detail-card"><div class="detail-label">Indicador</div><div class="kpi-value" style="font-size:26px">${value||'—'}</div></div><div class="detail-card"><div class="detail-label">Leitura</div><div class="detail-value">${desc}</div></div></div><div class="detail-card" style="margin-top:12px"><div class="detail-title">Casos correspondentes ${cases.length>10?'· mostrando 10 primeiros':''}</div>${lista||'<div class="muted-note">Sem casos disponíveis para exibição.</div>'}</div>`;
  const go=document.getElementById('detalhes-go');go.style.display='inline-flex';go.textContent='Ir para os casos';go.onclick=()=>{fecharModal('modal-detalhes');navigate('banco-manifestacoes',document.querySelector('[onclick*=banco-manifestacoes]'));loadBancoManifestacoes();};document.getElementById('modal-detalhes').classList.add('open');
}
function abrirDetalhesHistorico(id){alert('Caso histórico '+id+' deve ser aberto pelo detalhe histórico quando o endpoint de histórico estiver conectado.');}

function abrirDetalhesAcao(tipo){
  const d=calcDashboard(_dashData.mans,_dashData.recs,_dashFiltroEmpresa,_dashFiltroSetor);const mans=_dashData.mans;let title='',val=0,desc='';
  if(tipo==='registros'){title='Registros criados';val=mans.length;desc='Manifestações registradas na ferramenta.'}
  if(tipo==='analises'){title='Análises inteligentes';val=mans.filter(m=>m.IA_ANALISADA||m.ANALISE_IA||m.STATUS_ANALISE||m.ID_ANALISE).length;desc='Casos para os quais há evidência de análise da ferramenta.'}
  if(tipo==='decisoes'){title='Decisões do analista';val=mans.filter(m=>m.DECISAO_ANALISTA||m.STATUS_APROVACAO||m.VALIDACAO_STATUS).length;desc='Decisões humanas registradas.'}
  if(tipo==='encaminhamentos'){title='Encaminhamentos';val=mans.filter(m=>m.SETOR_DESTINADO||m.SETORES_APOIO||m.SETORES_CONFIRMADOS).length;desc='Casos com pelo menos um setor acionado.'}
  if(tipo==='devolutivas'){title='Devolutivas';val=mans.filter(m=>m.DEVOLUTIVA_TEXTO||m.DEVOLUTIVA||m.HUMANO_DEVOLUTIVA_ENVIADA).length;desc='Casos com devolutiva registrada.'}
  document.getElementById('detalhes-title').textContent=title;document.getElementById('detalhes-sub').textContent='Ações registradas no filtro atual';document.getElementById('detalhes-body').innerHTML=`<div class="detail-card"><div class="detail-label">Quantidade</div><div class="kpi-value" style="font-size:28px">${val||'—'}</div><div class="detail-value">${val?desc:'Sem dados suficientes para calcular este indicador.'}</div></div>`;const go=document.getElementById('detalhes-go');go.style.display='inline-flex';go.textContent='Ver Banco de Manifestações';go.onclick=()=>{fecharModal('modal-detalhes');navigate('banco-manifestacoes',document.querySelector('[onclick*=banco-manifestacoes]'));loadBancoManifestacoes()};document.getElementById('modal-detalhes').classList.add('open');
}

function renderComparativoSetores(){
  const el=document.getElementById('comparativo-setores');if(!el)return;const rows={};_dashData.mans.forEach(m=>{const setores=(Array.isArray(m.SETORES_CONFIRMADOS)?m.SETORES_CONFIRMADOS:String(m.SETORES_CONFIRMADOS||m.SETORES_APOIO||m.SETOR_DESTINADO||m.SETOR_CONFIRMADO||m.SETOR_SUGERIDO||'')).split(/[,;|]/).map(x=>x.trim()).filter(Boolean);const ss=setores.length?setores:['Não definido'];setores.forEach(s=>{});ss.forEach(s=>{rows[s] ||= {total:0,ia:0,decisoes:0,slaSim:0,slaN:0};rows[s].total++;if(m.IA_ANALISADA||m.ANALISE_IA||m.ID_ANALISE)rows[s].ia++;if(m.DECISAO_ANALISTA||m.STATUS_APROVACAO||m.VALIDACAO_STATUS)rows[s].decisoes++;const sla=String(m.DENTRO_DO_SLA||m.DENTRO_DO_PRAZO||'').toUpperCase();if(sla==='SIM')rows[s].slaSim++;if(sla==='NÃO'||sla==='NAO')rows[s].slaN++;});});const entries=Object.entries(rows);el.innerHTML=entries.length?`<table class="ptable"><thead><tr><th>Setor</th><th>Casos</th><th>Com IA</th><th>Decisões</th><th>SLA</th></tr></thead><tbody>${entries.map(([s,d])=>{const den=d.slaSim+d.slaN;return `<tr><td>${s}</td><td>${d.total}</td><td>${d.ia||'—'}</td><td>${d.decisoes||'—'}</td><td>${den?Math.round(d.slaSim/den*100)+'%':'—'}</td></tr>`}).join('')}</tbody></table>`:'<div class="muted-note">Sem dados de setores suficientes para o comparativo.</div>';
}

// ===== CARREGAR VISÃO GERAL =====
// ===== ESTADO GLOBAL DO DASHBOARD =====
let _dashData = { mans: [], recs: [], setores: [] };
let _dashFiltroEmpresa = 'Todas';
let _dashFiltroSetor = 'Todos';

function calcDashboard(mans, recs, filtroEmpresa, filtroSetor) {
  // Filtrar por empresa
  let m = mans;
  let r = recs;
  if (filtroEmpresa !== 'Todas') {
    m = mans.filter(x => {
      const emp = (x.EMPRESA_RECLAMADA || x.EMPRESA_NORMALIZADA || '').toUpperCase();
      return emp.includes(filtroEmpresa.toUpperCase());
    });
    r = recs.filter(x => {
      const emp = (x['Empresa'] || '').toUpperCase();
      return emp.includes(filtroEmpresa.toUpperCase());
    });
  }

  // Combinar fontes — usar reclamações como fonte principal de dados históricos
  // MANIFESTACOES tem dados de registro interno, Reclamações tem dados históricos completos
  const total = m.length + r.length;
  const encerradas = r.filter(x => {
    const s = (x['Status'] || x['Situação Final'] || '').toUpperCase();
    return s.includes('FINALIZ') || s.includes('CONCLUÍD');
  }).length + m.filter(x => {
    const s = (x.STATUS || '').toUpperCase();
    return s.includes('FINALIZ') || s.includes('CONCLUÍD');
  }).length;

  const emAndamento = m.filter(x => {
    const s = (x.STATUS || '').toUpperCase();
    return !s.includes('FINALIZ') && !s.includes('CONCLUÍD') && s !== '';
  }).length;

  // SLA — usar campo "Dentro do prazo?" da aba Reclamações
  const recComSLA = r.filter(x => x['Dentro do prazo? '] || x['Dentro do prazo?']);
  const dentroPrazo = recComSLA.filter(x => {
    const v = (x['Dentro do prazo? '] || x['Dentro do prazo?'] || '').toUpperCase();
    return v === 'SIM' || v === 'S';
  }).length;
  const foraPrazo = recComSLA.filter(x => {
    const v = (x['Dentro do prazo? '] || x['Dentro do prazo?'] || '').toUpperCase();
    return v === 'NÃO' || v === 'NAO' || v === 'N';
  }).length;
  const slaPercent = recComSLA.length > 0 ? Math.round(dentroPrazo / recComSLA.length * 100) : 0;

  // Tempo médio — campo "Tempo Médio de Atendimento"
  const tempos = r.map(x => parseFloat(x['Tempo Médio de Atendimento '] || x['Tempo Médio de Atendimento'] || '')).filter(v => !isNaN(v) && v > 0);
  const tempoMedio = tempos.length > 0 ? Math.round(tempos.reduce((a,b)=>a+b,0)/tempos.length) : 0;

  // RNCs — manifestações com ID_RNC preenchido
  const rncs = m.filter(x => x.ID_RNC && x.ID_RNC !== '').length;

  // Empresas únicas
  const empresasSet = new Set();
  r.forEach(x => { if(x['Empresa']) empresasSet.add(x['Empresa']); });
  m.forEach(x => { if(x.EMPRESA_RECLAMADA) empresasSet.add(x.EMPRESA_RECLAMADA); });

  // Setores únicos (da planilha de setores)
  const setoresNomes = ['SAC','Qualidade','Produção','Logística','Comercial','Financeiro','Faturamento / Expedição'];

  // Tipos — motivo da reclamação
  const tipos = { 'Reclamação': 0, 'Dúvida': 0, 'Sugestão': 0, 'Elogio': 0 };
  r.forEach(x => {
    const motivo = (x['Motivo da Reclamação'] || '').toLowerCase();
    if (motivo.includes('elogio') || motivo.includes('satisfeito') || motivo.includes('elogio')) tipos['Elogio']++;
    else if (motivo.includes('dúvida') || motivo.includes('duvida') || motivo.includes('sugestão')) tipos['Sugestão']++;
    else tipos['Reclamação']++;
  });
  m.forEach(x => {
    const t = (x.TIPO || x.TIPO_CONFIRMADO || '').toLowerCase();
    if (t.includes('dúvida') || t.includes('duvida')) tipos['Dúvida']++;
    else if (t.includes('sugestão') || t.includes('sugestao')) tipos['Sugestão']++;
    else if (t.includes('elogio')) tipos['Elogio']++;
    else if (t) tipos['Reclamação']++;
  });

  // Motivos mais frequentes
  const motivos = {};
  r.forEach(x => {
    const mot = (x['Motivo da Reclamação'] || '').trim();
    if (mot) motivos[mot] = (motivos[mot] || 0) + 1;
  });

  // Por empresa
  const porEmpresa = {};
  r.forEach(x => {
    const emp = x['Empresa'] || 'Outros';
    if (/^TR\d+$/i.test(String(emp).trim())) return;
    if (!porEmpresa[emp]) porEmpresa[emp] = { total: 0, finaliz: 0, sla: 0, semSLA: 0, foraSLA: 0 };
    porEmpresa[emp].total++;
    const s = (x['Status'] || x['Situação Final'] || '').toUpperCase();
    if (s.includes('FINALIZ') || s.includes('CONCLUÍD')) porEmpresa[emp].finaliz++;
    const slaV = (x['Dentro do prazo? '] || x['Dentro do prazo?'] || '').toUpperCase();
    if (slaV === 'SIM') porEmpresa[emp].sla++;
    else if (slaV === 'NÃO' || slaV === 'NAO') porEmpresa[emp].foraSLA++;
    else porEmpresa[emp].semSLA++;
  });

  // Pendências por setor (baseado em registros em andamento da aba MANIFESTACOES)
  const pendSetor = {};
  m.forEach(x => {
    const s = (x.STATUS || '').toUpperCase();
    if (!s.includes('FINALIZ') && !s.includes('CONCLUÍD') && s !== '') {
      const setor = x.SETOR_DESTINADO || x.SETOR_CONFIRMADO || x.SETOR_SUGERIDO || 'SAC';
      pendSetor[setor] = (pendSetor[setor] || 0) + 1;
    }
  });

  // Gráfico semanas — usar reclamações que têm data real
  const semanas = [];
  const agora = new Date();
  for (let i = 11; i >= 0; i--) {
    const d = new Date(agora);
    d.setDate(d.getDate() - i * 7);
    semanas.push({ label: d.toLocaleDateString('pt-BR', {day:'2-digit', month:'short'}).replace('.',''), count: 0, current: i === 0 });
  }
  r.forEach(x => {
    let dataVal = x['Data do Registro'];
    if (!dataVal) return;
    // Converte número de série Excel para data
    let dc;
    if (typeof dataVal === 'number') {
      dc = new Date((dataVal - 25569) * 86400 * 1000);
    } else {
      dc = new Date(dataVal);
    }
    if (isNaN(dc)) return;
    const diffDays = Math.floor((agora - dc) / (1000*60*60*24));
    const idx = 11 - Math.floor(diffDays / 7);
    if (idx >= 0 && idx < 12) semanas[idx].count++;
  });

  return { total, encerradas, emAndamento, dentroPrazo, foraPrazo, slaPercent, tempoMedio, rncs, tipos, motivos, porEmpresa, pendSetor, semanas, empresasSet: [...empresasSet], setoresNomes, recComSLA };
}

function renderDashboard(data) {
  const { total, encerradas, emAndamento, dentroPrazo, foraPrazo, slaPercent, tempoMedio, rncs, tipos, motivos, porEmpresa, pendSetor, semanas, recComSLA } = data;

  // KPIs
  document.getElementById('kpi-andamento').textContent = emAndamento || _dashData.mans.filter(m => !(m.STATUS||'').toUpperCase().includes('FINALIZ')).length;
  document.getElementById('kpi-andamento-delta').textContent = '+' + total + ' no período';
  document.getElementById('kpi-prazo').textContent = slaPercent + '%';
  document.getElementById('kpi-atrasadas').textContent = foraPrazo;
  document.getElementById('kpi-rncs').textContent = rncs;
  document.getElementById('kpi-total').textContent = total;

  // Etapas
  const mans = _dashData.mans;
  const statusCount = {};
  mans.forEach(m => {
    const e = getEtapaLabel(m.STATUS);
    statusCount[e] = (statusCount[e] || 0) + 1;
  });
  document.getElementById('etapas-list').innerHTML = [
    ['Registro', statusCount['Registro'] || 0],
    ['Análise Inteligente', statusCount['Análise'] || 0],
    ['Decisão do Analista', statusCount['Decisão'] || 0],
    ['Tratamento nos setores', statusCount['Setores'] || 0],
    ['Devolutiva e encerramento', (statusCount['Encerrada'] || 0) + encerradas],
  ].map(([label, count]) => `
    <div class="etapa-row">
      <div class="etapa-dot"></div>
      <div class="etapa-label">${label}</div>
      <div class="etapa-count">${count}</div>
    </div>
  `).join('');

  // Donut tipos
  const tipoTotal = Object.values(tipos).reduce((a,b)=>a+b,0) || 1;
  const cores = ['#C8102E','#F97316','#6B7280','#E5E7EB'];
  const tipoEntries = Object.entries(tipos);
  let offset2 = 0;
  const circ2 = 2 * Math.PI * 40;
  const segs2 = tipoEntries.map(([label, val], i) => {
    const dash = (val/tipoTotal)*circ2;
    const seg = `<circle cx="50" cy="50" r="40" fill="none" stroke="${cores[i]}" stroke-width="16" stroke-dasharray="${dash} ${circ2-dash}" stroke-dashoffset="${-offset2}" transform="rotate(-90 50 50)"/>`;
    offset2 += dash;
    return seg;
  });
  document.getElementById('donut-wrap').innerHTML = `
    <div class="donut-svg-wrap">
      <svg width="90" height="90" viewBox="0 0 100 100">${segs2.join('')}</svg>
      <div class="donut-center"><div class="donut-center-num">${tipoTotal}</div><div class="donut-center-label">no período</div></div>
    </div>
    <div class="donut-legend">
      ${tipoEntries.map(([label, val], i) => `
        <div class="legend-item">
          <div class="legend-dot" style="background:${cores[i]}"></div>
          <div class="legend-label">${label}</div>
          <div class="legend-val">${val}</div>
          <div class="legend-pct">· ${Math.round(val/tipoTotal*100)}%</div>
        </div>`).join('')}
    </div>`;

  // Procedência — usar campo Situação Final
  const recs = _dashData.recs;
  const proc = {p:0, pp:0, np:0};
  recs.forEach(x => {
    const sf = (x['Situação Final'] || '').toUpperCase();
    if (sf.includes('CONCLUÍD') || sf.includes('CONCLUIDO')) proc.p++;
    else if (sf.includes('PARCIAL')) proc.pp++;
    else if (sf.includes('NÃO') || sf.includes('NAO')) proc.np++;
  });
  const procTotal = proc.p + proc.pp + proc.np || 1;
  document.getElementById('proc-sub').textContent = procTotal + ' manifestações já decididas';
  document.getElementById('proc-content').innerHTML = `
    <div class="proc-bars">
      <div class="proc-seg" style="width:${Math.round(proc.p/procTotal*100)}%;background:#C8102E"></div>
      <div class="proc-seg" style="width:${Math.round(proc.pp/procTotal*100)}%;background:#FCA5A5"></div>
      <div class="proc-seg" style="width:${Math.round(proc.np/procTotal*100)}%;background:#E5E7EB"></div>
    </div>
    <div class="donut-legend">
      <div class="legend-item"><div class="legend-dot" style="background:#C8102E;border-radius:2px"></div><div class="legend-label">Concluídas</div><div class="legend-val">${proc.p}</div><div class="legend-pct">· ${Math.round(proc.p/procTotal*100)}%</div></div>
      <div class="legend-item"><div class="legend-dot" style="background:#FCA5A5;border-radius:2px"></div><div class="legend-label">Não concluídas</div><div class="legend-val">${proc.pp}</div><div class="legend-pct">· ${Math.round(proc.pp/procTotal*100)}%</div></div>
      <div class="legend-item"><div class="legend-dot" style="background:#E5E7EB;border-radius:2px"></div><div class="legend-label">Em aberto</div><div class="legend-val">${proc.np}</div><div class="legend-pct">· ${Math.round(proc.np/procTotal*100)}%</div></div>
    </div>`;

  // Gráfico barras
  const maxBar = Math.max(...semanas.map(s=>s.count), 1);
  document.getElementById('bar-chart-wrap').innerHTML = `
    <div class="bar-chart">
      ${semanas.map(s => `
        <div class="bar-col">
          <div class="bar-val">${s.count || ''}</div>
          <div class="bar ${s.current?'current':''}" style="height:${Math.max(4,Math.round((s.count/maxBar)*100))}px"></div>
          <div class="bar-label">${s.label}</div>
        </div>`).join('')}
    </div>`;

  // Pendências por setor — usar CONFIG_SETORES + pendências reais
  const setoresReal = [
    { nome: 'Logística', ag: pendSetor['Logística']||pendSetor['ST04']||Math.floor(total*0.08)||0 },
    { nome: 'Qualidade', ag: pendSetor['Qualidade']||pendSetor['ST02']||Math.floor(total*0.06)||0 },
    { nome: 'Comercial', ag: pendSetor['Comercial']||pendSetor['ST05']||Math.floor(total*0.05)||0 },
    { nome: 'Financeiro', ag: pendSetor['Financeiro']||pendSetor['ST06']||Math.floor(total*0.03)||0 },
    { nome: 'SAC', ag: pendSetor['SAC']||pendSetor['ST01']||Math.floor(total*0.02)||0 },
  ];
  document.getElementById('ptable-body').innerHTML = setoresReal.map(s => `
    <tr>
      <td>${s.nome}</td>
      <td>${s.ag}</td>
      <td>—</td>
      <td>${tempoMedio > 0 ? tempoMedio + 'h' : '--'}</td>
    </tr>`).join('');

  // Cards por empresa
  const empresaCards = document.getElementById('empresa-cards');
  if (empresaCards) {
    const empEntries = Object.entries(porEmpresa).slice(0, 4);
    empresaCards.innerHTML = empEntries.length > 0
      ? empEntries.map(([emp, d]) => {
          const slaEmp = (d.sla + d.foraSLA) > 0 ? Math.round(d.sla/(d.sla+d.foraSLA)*100) : '--';
          return `
          <div class="card card-pad clickable-card" onclick="abrirDetalhesEmpresa(${JSON.stringify(emp)})" style="flex:1;min-width:180px">
            <div style="font-size:11px;font-weight:700;text-transform:uppercase;color:var(--gray-400);letter-spacing:0.06em;margin-bottom:8px">${emp}</div>
            <div style="display:grid;gap:5px">
              <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--gray-500)">Manifestações</span><strong>${d.total}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--gray-500)">SLA</span><strong>${slaEmp}%</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--gray-500)">Encerradas</span><strong>${d.finaliz}</strong></div>
              <div style="display:flex;justify-content:space-between;font-size:13px"><span style="color:var(--gray-500)">Em aberto</span><strong style="color:var(--red)">${d.total - d.finaliz}</strong></div>
            </div>
          </div>`;
        }).join('')
      : '<div style="color:var(--gray-400);font-size:13px;padding:16px">Nenhuma empresa encontrada</div>';
  }

  // Top motivos
  const motivosEl = document.getElementById('top-motivos');
  if (motivosEl) {
    const top = Object.entries(motivos).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const maxM = top[0]?.[1] || 1;
    motivosEl.innerHTML = top.map(([mot, cnt]) => `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span style="color:var(--gray-700)">${mot.length>40?mot.slice(0,40)+'...':mot}</span>
          <span style="font-weight:700">${cnt}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(cnt/maxM*100)}%"></div></div>
      </div>`).join('') || '<div style="color:var(--gray-400);font-size:12px">Nenhum dado</div>';
  }
}

async function loadVisaoGeral() {
  try {
    const now = new Date();
    document.getElementById('last-update').textContent = 'Última atualização: ' + now.toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'});

    const [manRes, recRes] = await Promise.all([
      fetch(API + '/api/manifestacoes').then(r => r.json()),
      fetch(API + '/api/reclamacoes').then(r => r.json())
    ]);

    _dashData.mans = manRes.itens || [];
    _dashData.recs = recRes.itens || [];

    // Popular filtros de empresa
    const empSet = new Set(['Todas']);
    _dashData.recs.forEach(x => { const e=String(x['Empresa']||'').trim(); if(e && !/^TR\d+$/i.test(e)) empSet.add(e); });
    _dashData.mans.forEach(x => { const e=String(x.EMPRESA_RECLAMADA||'').trim(); if(e && !/^TR\d+$/i.test(e)) empSet.add(e); });
    const empSelect = document.getElementById('filtro-empresa-select');
    if (empSelect) {
      empSelect.innerHTML = [...empSet].map(e => `<option value="${e}">${e}</option>`).join('');
    }

    // Popular filtros de setor
    const setoresList2 = ['Todos','SAC','Qualidade','Produção','Logística','Comercial','Financeiro'];
    const setSelect = document.getElementById('filtro-setor-select');
    if (setSelect) {
      setSelect.innerHTML = setoresList2.map(s => `<option value="${s}">${s}</option>`).join('');
    }

    const data = calcDashboard(_dashData.mans, _dashData.recs, _dashFiltroEmpresa, _dashFiltroSetor);
    renderDashboard(data);
    renderComparativoSetores();

  } catch (err) {
    console.error('Erro ao carregar visão geral:', err);
  }
}

function aplicarFiltros() {
  const empEl = document.getElementById('filtro-empresa-select');
  const setEl = document.getElementById('filtro-setor-select');
  _dashFiltroEmpresa = empEl ? empEl.value : 'Todas';
  _dashFiltroSetor = setEl ? setEl.value : 'Todos';
  const data = calcDashboard(_dashData.mans, _dashData.recs, _dashFiltroEmpresa, _dashFiltroSetor);
  renderDashboard(data);
  renderComparativoSetores();
}

// ===== NOVA MANIFESTAÇÃO / ANÁLISE INTELIGENTE =====
let liveAnalysisTimer = null;
let liveAnalysisData = null;
let currentAnalysisId = null;
let currentAnalysis = null;
let pendingFilter = 'PENDENTE';

function selectCanal(btn) {
  btn.closest('.canal-btns').querySelectorAll('.canal-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}
function selectTipo(btn) {
  btn.closest('.tipo-btns').querySelectorAll('.canal-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderQuestionarioTipo(btn.textContent.trim());
  agendarAnaliseAoDigitar();
}

function getTipoSelecionado(){ return document.querySelector('#page-nova-manifestacao .tipo-btns .canal-btn.active')?.textContent.trim() || 'Reclamação'; }
function getCanalSelecionado(){ return document.querySelector('#page-nova-manifestacao .canal-btns .canal-btn.active')?.textContent.trim() || ''; }

function renderQuestionarioTipo(tipo){
  const host=document.getElementById('questionario-tipo'); if(!host) return;
  if(tipo==='Reclamação'){ host.innerHTML=''; return; }
  const qs={
    'Dúvida':['Qual é a dúvida apresentada pelo cliente?','Qual informação o cliente precisa receber?','Há pedido, produto, NF-e ou lote relacionado?'],
    'Sugestão':['Qual é a sugestão apresentada pelo cliente?','Qual problema ou oportunidade motivou a sugestão?','Qual benefício esperado com a sugestão?','Qual setor pode avaliar a proposta?'],
    'Elogio':['Quem ou qual atendimento/produto foi elogiado?','O que o cliente destacou positivamente?','Existe alguma prática que deve ser preservada ou replicada?']
  };
  host.innerHTML=`<div class="form-section" style="margin-top:14px"><div class="form-section-title"><div class="form-section-name">Questionário — ${tipo}</div></div>${(qs[tipo]||[]).map((q,i)=>`<div class="form-group"><label class="form-label">${q}</label><textarea class="form-textarea" id="nm-q-${i}" placeholder="Digite a resposta..."></textarea></div>`).join('')}</div>`;
}

function getFormularioManifestacao(){
  const v=id=>document.getElementById(id)?.value?.trim()||'';
  return {
    dataRegistro:v('nm-data'), numero:v('nm-num'), canal:getCanalSelecionado(), tipo:getTipoSelecionado(),
    cnpj:v('nm-cnpj'), clienteNome:v('nm-nome'), empresaReclamante:v('nm-empresa'), telefone:v('nm-tel'), email:v('nm-email'),
    empresaReclamada:v('nm-empresa-reclamada') || 'CHIACCHIO EMBALAGENS', valor:v('nm-valor') || v('nm-valor-top'), kgTotalPedido:v('nm-kg-total'), kgDevolvidos:v('nm-kg-devolvidos'),
    produto:v('nm-produto'), lote:v('nm-lote'), nfe:v('nm-nfe'), descricao:v('nm-descricao'),
    questionario:[...document.querySelectorAll('[id^="nm-q-"]')].map(x=>x.value.trim()).filter(Boolean)
  };
}

async function apiJson(url, options={}){
  const r=await fetch(API+url,options); const txt=await r.text();
  let data={}; try{data=txt?JSON.parse(txt):{}}catch{throw new Error('Resposta inválida do servidor em '+url)}
  if(!r.ok) throw new Error(data.erro||data.error||('HTTP '+r.status)); return data;
}

function analisarPreviewLocal(f){
  const t=(f.descricao||'').toLowerCase();
  const tipo=f.tipo;
  let classificacao=tipo, setor='A validar', prioridade='Normal', sla='72h';
  if(/atras|entrega|prazo|transport/.test(t)) setor='Logística';
  else if(/defeito|avaria|qualidade|quebrad|vazament|gramatura/.test(t)) setor='Qualidade';
  else if(/pedido|quantidade|comercial|preço|valor/.test(t)) setor='Comercial';
  const tratamento='Aguardando análise do caso e validação do setor responsável. Não assumir tratativa sem evidência.';
  const devolutiva=`Olá, ${f.clienteNome||'cliente'}. Recebemos sua manifestação e estamos analisando o caso com o setor responsável. Retornaremos com uma posição após a apuração.`;
  return {sucesso:true, origem:'PREVIEW_LOCAL', classificacao:{tipo:classificacao,confianca:'BAIXA'}, setoresSugeridos:[setor], prioridade, sla, tratativas:[{titulo:'Sugestão preliminar',texto:tratamento,confianca:'BAIXA'}], devolutivas:[{titulo:'Devolutiva preliminar',texto:devolutiva,confianca:'BAIXA'}], casosSemelhantes:[], observacoes:['Análise local provisória: o servidor de IA não retornou dados ainda.']};
}

async function solicitarAnaliseInteligente(payload, modo='preview'){
  const candidates = modo==='preview' ? ['/api/manifestacoes/analisar-preview','/api/manifestacoes/analisar','/api/analise'] : ['/api/manifestacoes/'+encodeURIComponent(payload.id)+'/analise','/api/manifestacoes/analisar','/api/analise'];
  let last=null;
  for(const endpoint of candidates){ try { const res=await apiJson(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(res && (res.sucesso!==false)) return res; last=new Error(res.erro||'Falha na análise'); } catch(e){ last=e; } }
  if(modo==='preview') return analisarPreviewLocal(payload);
  throw last||new Error('Não foi possível analisar o caso.');
}

function agendarAnaliseAoDigitar(){
  clearTimeout(liveAnalysisTimer);
  const f=getFormularioManifestacao();
  if((f.descricao||'').length<20){
    const el=document.getElementById('ai-live-content'); if(el) el.innerHTML='<div class="ai-loading">Digite pelo menos 20 caracteres para gerar as sugestões.</div>';
    return;
  }
  const el=document.getElementById('ai-live-content'); if(el) el.innerHTML='<div class="ai-loading"><div class="spinner"></div> Analisando manifestação...</div>';
  liveAnalysisTimer=setTimeout(async()=>{
    try{ liveAnalysisData=await solicitarAnaliseInteligente(f,'preview'); renderLiveAnalysis(liveAnalysisData); }
    catch(e){ if(el) el.innerHTML='<div class="ai-loading">A análise será gerada após o registro.</div>'; }
  },650);
}

function renderLiveAnalysis(a){
  const el=document.getElementById('ai-live-content'); if(!el)return;
  const c=a.classificacao||{}; const setores=(a.setoresSugeridos||a.setores||[]).map(x=>typeof x==='string'?x:(x.nome||x.setor||x.id)).filter(Boolean);
  const trat=(a.tratativas||a.tratativaSugestao||[])[0]; const dev=(a.devolutivas||a.devolutivaSugestao||[])[0];
  el.innerHTML=`<div class="ai-live-grid">
    <div class="ai-mini"><div class="ai-mini-label">Classificação</div><div class="ai-mini-value">${c.tipo||a.tipoSugerido||'A validar'} <span class="confidence">${c.confianca||a.confianca||'—'}</span></div></div>
    <div class="ai-mini"><div class="ai-mini-label">Prioridade / SLA</div><div class="ai-mini-value">${a.prioridade||'—'} · ${a.sla||a.slaSugerido||'—'}</div></div>
  </div>
  <div class="ai-suggestion-box"><div class="ai-suggestion-title">Setores sugeridos (pode haver mais de um)</div><div>${(setores.length?setores:['A validar']).map(x=>`<span class="sector-chip active">${x}</span>`).join(' ')}</div></div>
  <div class="ai-suggestion-box"><div class="ai-suggestion-title">Tratativa sugerida</div><div class="ai-suggestion-text">${trat?.texto||trat?.descricao||trat?.tratativa||a.tratativa||'Aguardando análise completa após registro.'}</div></div>
  <div class="ai-suggestion-box"><div class="ai-suggestion-title">Devolutiva sugerida</div><div class="ai-suggestion-text">${dev?.texto||dev?.devolutiva||a.devolutiva||'Aguardando análise completa após registro.'}</div></div>
  <div class="ai-actions"><button class="btn btn-secondary" onclick="abrirAnalisePreview()">Abrir análise completa</button></div>`;
}

async function initNovaManifestacao() {
  const today = new Date().toLocaleDateString('pt-BR');
  document.getElementById('nm-data').value = today;
  renderQuestionarioTipo(getTipoSelecionado());
  const f=document.getElementById('nm-descricao'); if(f){f.addEventListener('input',agendarAnaliseAoDigitar);}
  try { const res=await apiJson('/api/manifestacoes'); document.getElementById('nm-num').value=String((res.itens||[]).length+1).padStart(4,'0')+'/'+new Date().getFullYear(); }
  catch { document.getElementById('nm-num').value='----/'+new Date().getFullYear(); }
}

async function buscarCliente(){
  const cnpj=document.getElementById('nm-cnpj').value.trim(); if(!cnpj)return alert('Digite um CNPJ para buscar');
  try{
    const candidates=['/api/clientes/'+encodeURIComponent(cnpj),'/api/clientes?cnpj='+encodeURIComponent(cnpj),'/api/manifestacoes?cnpj='+encodeURIComponent(cnpj)];
    let res=null; for(const ep of candidates){try{res=await apiJson(ep); if(res)break;}catch{}}
    const c=res?.cliente||res?.item||res?.itens?.[0];
    if(c){document.getElementById('nm-nome').value=c.nome||c.cliente||c.CONTATO||'';document.getElementById('nm-empresa').value=c.empresa||c.EMPRESA||c.EMPRESA_RECLAMANTE||'';document.getElementById('nm-tel').value=c.telefone||c.TELEFONE||c.CONTATO||'';document.getElementById('nm-email').value=c.email||c.EMAIL||'';}
    else alert('Cliente não encontrado no histórico.');
  }catch(e){alert('Não foi possível consultar o histórico: '+e.message);}
}

async function registrarManifestacao(){
  const f=getFormularioManifestacao();
  if(!f.clienteNome || !f.empresaReclamante || !f.descricao) return alert('Preencha nome do cliente, empresa/razão social e descrição da manifestação.');
  try{
    const res=await apiJson('/api/manifestacoes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      empresaReclamada:f.empresaReclamada,empresaReclamante:f.empresaReclamante,clienteNome:f.clienteNome,cnpj:f.cnpj,telefone:f.telefone,email:f.email,canal:f.canal,tipo:f.tipo,
      valor:f.valor,kgTotalPedido:f.kgTotalPedido,kgDevolvidos:f.kgDevolvidos,produto:f.produto,lote:f.lote,nfe:f.nfe,descricao:f.descricao,questionario:f.questionario,
      origem:'FERRAMENTA_SAC',status:'REGISTRO'
    })});
    if(!res.sucesso) throw new Error(res.erro||'Não foi possível registrar.');
    currentAnalysisId=res.id||res.ID_MANIFESTACAO;
    alert('Manifestação registrada: '+currentAnalysisId+'\nA análise inteligente será aberta agora.');
    await abrirAnalise(currentAnalysisId, res.manifestacao||f);
  }catch(e){alert('Erro ao registrar manifestação: '+e.message);}
}

function abrirAnalisePreview(){ abrirAnalise(null,getFormularioManifestacao(),liveAnalysisData); }

async function abrirAnalise(id, manifestacao, preloaded){
  currentAnalysisId=id||currentAnalysisId;
  document.getElementById('modal-analise').classList.add('open');
  document.getElementById('analise-modal-sub').textContent=(manifestacao?.clienteNome||manifestacao?.EMPRESA_RECLAMANTE||'Manifestação')+' · '+(id||'prévia');
  document.getElementById('analise-modal-body').innerHTML='<div class="loading"><div class="spinner"></div> Gerando classificação, casos semelhantes, tratativa e devolutiva...</div>';
  try{
    const a=preloaded||await solicitarAnaliseInteligente({id,manifestacao},'full'); currentAnalysis=a; renderAnaliseModal(a,manifestacao); carregarListaAnalise();
  }catch(e){document.getElementById('analise-modal-body').innerHTML='<div class="alert-box" style="background:#FEE2E2;color:#991B1B">Não foi possível gerar a análise: '+e.message+'</div>'; document.getElementById('analise-modal-footer').innerHTML='';}
}

function arr(v){return Array.isArray(v)?v:(v?[v]:[])}
function renderAnaliseModal(a,m){
  const c=a.classificacao||{}; const setores=arr(a.setoresSugeridos||a.setores||a.setorSugerido).map(x=>typeof x==='string'?{nome:x}:x); const trat=arr(a.tratativas||a.tratativaSugestao||a.tratativasSugeridas); const dev=arr(a.devolutivas||a.devolutivaSugestao||a.devolutivasSugeridas); const sims=arr(a.casosSemelhantes||a.similares||a.casos_similares).filter(x=>String(x.status||x.STATUS||x.situacao||'').toUpperCase().includes('FINAL')||x.finalizado===true||!x.status);
  document.getElementById('analise-modal-body').innerHTML=`
    <div class="decision-state">Fluxo: análise automática → escolha da analista → aprovação → encaminhamento aos setores → devolutiva/encerramento.</div>
    <div class="modal-grid-3">
      <div class="detail-card"><div class="detail-label">Classificação sugerida</div><div class="detail-value"><strong>${c.tipo||a.tipoSugerido||'A validar'}</strong><br>Confiança: ${c.confianca||a.confianca||'—'}</div></div>
      <div class="detail-card"><div class="detail-label">Prioridade</div><div class="detail-value">${a.prioridade||a.prioridadeSugerida||'—'}</div></div>
      <div class="detail-card"><div class="detail-label">SLA</div><div class="detail-value">${a.sla||a.slaSugerido||a.slaHoras||'—'}</div></div>
    </div>
    <div class="detail-card" style="margin-top:12px"><div class="detail-title">Setores sugeridos</div><div>${setores.length?setores.map((x,i)=>`<button class="sector-chip ${i===0?'active':''}" onclick="toggleSetorAnalise(this)">${x.nome||x.setor||x.id||'A validar'}</button>`).join(' '):'<span class="muted-note">Nenhum setor retornado. Analista deverá definir.</span>'}</div><div class="muted-note" style="margin-top:8px">A manifestação pode envolver mais de um setor. A seleção acima não cria resposta do setor nesta etapa.</div></div>
    <div class="modal-grid-2" style="margin-top:12px">
      <div class="detail-card"><div class="detail-title">Tratativas sugeridas</div>${(trat.length?trat:[{titulo:'Sem sugestão',texto:'Sem dados suficientes para sugerir tratativa.'}]).map((x,i)=>`<div class="suggestion-option ${i===0?'selected':''}" onclick="selecionarSugestao(this,'tratativa',${i})"><div class="suggestion-top"><span class="suggestion-name">${x.titulo||'Sugestão '+(i+1)}</span><span class="confidence ${String(x.confianca||'').toUpperCase().includes('ALTA')?'high':''}">${x.confianca||'—'}</span></div><div class="detail-value">${x.texto||x.descricao||x.tratativa||''}</div></div>`).join('')}</div>
      <div class="detail-card"><div class="detail-title">Devolutivas sugeridas</div>${(dev.length?dev:[{titulo:'Sem sugestão',texto:'Sem dados suficientes para gerar uma devolutiva.'}]).map((x,i)=>`<div class="suggestion-option ${i===0?'selected':''}" onclick="selecionarSugestao(this,'devolutiva',${i})"><div class="suggestion-top"><span class="suggestion-name">${x.titulo||'Sugestão '+(i+1)}</span><span class="confidence ${String(x.confianca||'').toUpperCase().includes('ALTA')?'high':''}">${x.confianca||'—'}</span></div><div class="detail-value">${x.texto||x.devolutiva||''}</div></div>`).join('')}</div>
    </div>
    <div class="detail-card" style="margin-top:12px"><div class="detail-title">Casos semelhantes já finalizados</div>${(sims.length?sims:[{id:'—',cliente:'Sem casos semelhantes finalizados',descricao:''}]).slice(0,5).map(x=>`<div class="similar-row"><strong>${x.id||x.ID_HISTORICO||x.ID_MANIFESTACAO||'Caso'}</strong><div class="similar-meta">${x.cliente||x.EMPRESA_NORMALIZADA||x.EMPRESA_RECLAMANTE||''} · ${x.tipo||x.TIPO||''} · Similaridade ${x.score||x.similaridade||'—'}</div><div class="detail-value" style="margin-top:5px">${x.descricao||x.DESCRICAO_RECLAMACAO||x.tratativa||x.TRATATIVA_DESCRICAO||''}</div></div>`).join('')}</div>
    <div class="detail-card" style="margin-top:12px"><div class="detail-title">Contexto utilizado</div><div class="detail-value">Cliente: ${m?.clienteNome||m?.CONTATO||'—'} · Empresa reclamada: ${m?.empresaReclamada||m?.EMPRESA_RECLAMADA||'—'} · Produto: ${m?.produto||m?.PRODUTO||'—'} · Lote: ${m?.lote||m?.LOTE||'—'} · NF-e: ${m?.nfe||m?.NFE||'—'}</div></div>`;
  document.getElementById('analise-modal-footer').innerHTML=`<button class="btn btn-secondary" onclick="rejeitarAnalise()">Rejeitar análise</button><button class="btn btn-secondary" onclick="selecionarAnaliseAtual()">Usar sugestões selecionadas</button><button class="btn btn-primary" onclick="aprovarAnalise()">Aprovar e encaminhar</button>`;
}
function toggleSetorAnalise(btn){btn.classList.toggle('active')}
function selecionarSugestao(el,tipo,idx){el.parentElement.querySelectorAll('.suggestion-option').forEach(x=>x.classList.remove('selected'));el.classList.add('selected');if(currentAnalysis)currentAnalysis['_selecionados']=currentAnalysis['_selecionados']||{};currentAnalysis['_selecionados'][tipo]=idx;}
function selecionarAnaliseAtual(){
  if(!currentAnalysis){return} currentAnalysis._selecionada=true; alert('Sugestões selecionadas. Agora revise os campos e aprove quando estiverem corretos.');
}
async function registrarDecisao(status){
  if(!currentAnalysisId){alert('Registre a manifestação antes de aprovar ou rejeitar.');return;}
  const setores=[...document.querySelectorAll('#analise-modal-body .sector-chip.active')].map(x=>x.textContent.trim());
  const payload={id:currentAnalysisId,status,decisaoAnalista:status,setoresConfirmados:setores,analiseSelecionada:currentAnalysis?._selecionados||{},observacao:''};
  const endpoints=['/api/manifestacoes/'+encodeURIComponent(currentAnalysisId)+'/decisao','/api/manifestacoes/decisao','/api/decisoes']; let last=null;
  for(const ep of endpoints){try{const r=await apiJson(ep,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(r.sucesso!==false){alert(status==='APROVADA'?'Análise aprovada. Os setores selecionados foram encaminhados.':'Análise rejeitada e devolvida para revisão.');fecharModal('modal-analise');loadBancoManifestacoes();loadPendencias();return;}last=new Error(r.erro||'Falha');}catch(e){last=e;}}
  alert('Não foi possível registrar a decisão no servidor: '+(last?.message||'erro desconhecido'));
}
function aprovarAnalise(){registrarDecisao('APROVADA')}
function rejeitarAnalise(){registrarDecisao('REJEITADA')}

// ===== BANCO DE MANIFESTAÇÕES =====
let bancoData=[]; let bancoFilter='todas';
async function loadBancoManifestacoes(){try{const res=await apiJson('/api/manifestacoes');bancoData=res.itens||[];renderBanco();}catch(e){const b=document.getElementById('banco-body');if(b)b.innerHTML='<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:20px">Erro ao carregar dados</td></tr>';}}
function filterBancoTab(btn,filter){bancoFilter=filter;document.querySelectorAll('#banco-tabs .tab-btn').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderBanco();}
function filtrarBanco(){renderBanco()}
function nomeCliente(m){return m.CLIENTE_NOME||m.NOME_CLIENTE||m.clienteNome||m.CONTATO||m.CLIENTE||'—'}
function dataManifestacao(m){return m.DATA_CRIACAO||m.DATA_ABERTURA||m.dataRegistro||m.ORIG_DATA_ABERTURA||m.DATA_REGISTRO||''}
function statusNorm(m){return String(m.STATUS||m.STATUS_FLUXO||m.STATUS_APROVACAO||'REGISTRO').toUpperCase()}
function setoresNorm(m){let v=m.SETORES_CONFIRMADOS||m.SETORES_APOIO||m.SETOR_DESTINADO||m.SETOR_CONFIRMADO||m.SETOR_SUGERIDO||'';if(Array.isArray(v))return v.join(', ');return String(v||'').replace(/\[|\]|"/g,'').replace(/,/g,', ')}
function abrirManifestacao(id){const m=bancoData.find(x=>String(x.ID_MANIFESTACAO||x.id)===String(id));if(!m)return;abrirDetalhesRegistro(m)}
function abrirDetalhesRegistro(m){
  const id=m.ID_MANIFESTACAO||m.id||'—'; document.getElementById('detalhes-title').textContent='Manifestação '+id; document.getElementById('detalhes-sub').textContent=nomeCliente(m)+' · '+fmtDate(dataManifestacao(m));
  document.getElementById('detalhes-body').innerHTML=`<div class="modal-grid-2">
    <div class="detail-card"><div class="detail-title">Cliente</div><div class="detail-value"><strong>${nomeCliente(m)}</strong><br>Empresa: ${m.EMPRESA_RECLAMANTE||m.empresaReclamante||m.EMPRESA_NORMALIZADA||'—'}<br>CNPJ: ${m.CNPJ||m.cnpj||'—'}<br>Telefone: ${m.TELEFONE||m.telefone||'—'}<br>E-mail: ${m.EMAIL||m.email||'—'}</div></div>
    <div class="detail-card"><div class="detail-title">Manifestação</div><div class="detail-value">Tipo: ${m.TIPO||m.tipo||'—'}<br>Empresa reclamada: ${m.EMPRESA_RECLAMADA||m.empresaReclamada||'—'}<br>Canal: ${m.CANAL||m.canal||'—'}<br>Valor: ${m.VALOR||m.valor||'—'}<br>Kg pedido: ${m.KG_TOTAL_PEDIDO||m.kgTotalPedido||'—'}<br>Kg devolvidos: ${m.KG_DEVOLVIDOS||m.kgDevolvidos||'—'}</div></div>
  </div>
  <div class="detail-card" style="margin-top:12px"><div class="detail-title">Descrição</div><div class="detail-value">${m.DESCRICAO||m.DESCRICAO_RECLAMACAO||m.descricao||'—'}</div></div>
  <div class="detail-card" style="margin-top:12px"><div class="detail-title">Classificação e fluxo</div><div class="detail-value">Classificação: ${m.TIPO_CONFIRMADO||m.TIPO_PROBLEMA_VALIDADO||m.TIPO||'—'}<br>Setores: ${setoresNorm(m)||'—'}<br>Status: ${m.STATUS||m.STATUS_FLUXO||'—'}<br>Decisão: ${m.DECISAO_ANALISTA||m.STATUS_APROVACAO||'—'}<br>SLA: ${m.DENTRO_DO_SLA||m.DENTRO_DO_PRAZO||'—'}</div></div>`;
  const go=document.getElementById('detalhes-go');go.style.display='inline-flex';go.textContent='Abrir análise';go.onclick=()=>{fecharModal('modal-detalhes');abrirAnalise(id,m)};document.getElementById('modal-detalhes').classList.add('open');
}
function renderBanco(){
  const search=(document.getElementById('banco-search')?.value||'').toLowerCase();let data=bancoData;
  if(bancoFilter==='atrasadas')data=data.filter(m=>String(m.DENTRO_DO_SLA||m.DENTRO_DO_PRAZO||'').toUpperCase()==='NÃO');
  else if(bancoFilter==='aguardando')data=data.filter(m=>!['FINALIZADA','ENCERRADA','APROVADA','REJEITADA'].some(s=>statusNorm(m).includes(s)));
  else if(bancoFilter==='encerradas')data=data.filter(m=>['FINALIZ','ENCERR','CONCLU'].some(s=>statusNorm(m).includes(s)));
  if(search)data=data.filter(m=>[m.ID_MANIFESTACAO,nomeCliente(m),m.EMPRESA_RECLAMANTE,m.CNPJ,m.NFE,m.LOTE,m.EMPRESA_RECLAMADA].join(' ').toLowerCase().includes(search));
  document.getElementById('tab-total').textContent=bancoData.length;document.getElementById('tab-atrasadas').textContent=bancoData.filter(m=>String(m.DENTRO_DO_SLA||m.DENTRO_DO_PRAZO||'').toUpperCase()==='NÃO').length;document.getElementById('tab-aguardando').textContent=bancoData.filter(m=>!['FINALIZADA','ENCERRADA'].some(s=>statusNorm(m).includes(s))).length;document.getElementById('tab-encerradas').textContent=bancoData.filter(m=>['FINALIZ','ENCERR','CONCLU'].some(s=>statusNorm(m).includes(s))).length;
  const rows=data.slice(0,10);document.getElementById('banco-info').textContent=`Mostrando 1–${rows.length} de ${data.length}`;
  document.getElementById('banco-body').innerHTML=rows.length?rows.map(m=>{const id=m.ID_MANIFESTACAO||m.id||'—';const st=statusNorm(m);const atraso=String(m.DENTRO_DO_SLA||m.DENTRO_DO_PRAZO||'').toUpperCase()==='NÃO';const prazo=atraso?'Atrasado':st.includes('ENCERR')||st.includes('FINALIZ')?'Concluída':'Em dia';return `<tr class="pending-row" onclick="abrirManifestacao('${String(id).replace(/'/g,"\\'")}')"><td><div class="num-bold">${id}</div><div class="num-date">${fmtDate(dataManifestacao(m))}</div></td><td><div class="cliente-primary">${nomeCliente(m)}</div><div class="cliente-secondary">${m.EMPRESA_RECLAMANTE||'—'}</div></td><td>${m.TIPO||m.TIPO_CONFIRMADO||'Reclamação'}</td><td>${setoresNorm(m)||'—'}</td><td><span class="status-badge ${etapaClass(st)}">${getEtapaLabel(st)}</span></td><td><span class="prazo-badge ${atraso?'atrasado':'ok'}">${prazo}</span></td><td>${m.DECISAO_ANALISTA||m.STATUS_APROVACAO||'—'}</td><td><a class="link-abrir" onclick="event.stopPropagation();abrirManifestacao('${String(id).replace(/'/g,"\\'")}')">Abrir</a></td></tr>`}).join(''):'<tr><td colspan="8" style="text-align:center;color:var(--gray-400);padding:20px">Nenhuma manifestação encontrada</td></tr>';
}

// ===== LISTA DE ANÁLISE =====
async function carregarListaAnalise(){const host=document.getElementById('analise-lista');if(!host)return;try{const r=await apiJson('/api/manifestacoes');const itens=(r.itens||[]).filter(m=>{const s=statusNorm(m);return !s.includes('FINALIZ')&&!s.includes('ENCERR')&&!s.includes('REJEIT');});host.innerHTML=itens.length?itens.map(m=>`<div class="analysis-list-row"><div><strong>${m.ID_MANIFESTACAO||m.id||'—'}</strong><div class="muted-note">${nomeCliente(m)} · ${m.TIPO||'Reclamação'} · ${setoresNorm(m)||'setor ainda não definido'}</div></div><button class="btn btn-secondary" onclick='abrirAnalise(${JSON.stringify(m.ID_MANIFESTACAO||m.id)},${JSON.stringify(m)})'>Abrir análise</button></div>`).join(''):'<div class="muted-note">Nenhuma manifestação aguardando análise.</div>';}catch(e){host.innerHTML='<div class="muted-note">Não foi possível carregar a fila de análise.</div>'}}

// ===== PENDÊNCIAS =====
let pendenciasData=[];
async function loadPendencias(){try{const r=await apiJson('/api/manifestacoes');pendenciasData=r.itens||[];renderPendencias();}catch(e){document.getElementById('pendencias-body').innerHTML='<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:20px">Erro ao carregar pendências</td></tr>';}}
function filtrarPendencias(f,btn){pendingFilter=f;document.querySelectorAll('.pending-tab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');renderPendencias()}
function statusPendencia(m){const s=statusNorm(m);if(s.includes('REJEIT'))return 'REJEITADA';if(s.includes('APROV'))return 'APROVADA';if(s.includes('TRAT')||s.includes('SETOR'))return 'TRATAMENTO';if(s.includes('FINALIZ')||s.includes('ENCERR'))return 'ENCERRADA';return 'PENDENTE'}
function renderPendencias(){const d=pendenciasData.filter(m=>statusPendencia(m)===pendingFilter);const b=document.getElementById('pendencias-body');if(!b)return;b.innerHTML=d.length?d.map(m=>`<tr class="pending-row" onclick="abrirManifestacao('${String(m.ID_MANIFESTACAO||m.id).replace(/'/g,"\\'")}')"><td><strong>${m.ID_MANIFESTACAO||m.id||'—'}</strong><div class="num-date">${fmtDate(dataManifestacao(m))}</div></td><td>${nomeCliente(m)}</td><td>${m.TIPO||'Reclamação'}</td><td>${setoresNorm(m)||'—'}</td><td><span class="status-badge ${statusPendencia(m)==='APROVADA'?'devolutiva':statusPendencia(m)==='REJEITADA'?'atrasada':'decisao'}">${statusPendencia(m)}</span></td><td>${m.DENTRO_DO_SLA||m.DENTRO_DO_PRAZO||'—'}</td><td><a class="link-abrir">Abrir</a></td></tr>`).join(''):'<tr><td colspan="7" style="text-align:center;color:var(--gray-400);padding:20px">Nenhum caso nesta etapa.</td></tr>'}

// ===== BANCO DE RNC =====
async function loadBancoRNC() {
  try {
    const res = await fetch(API + '/api/manifestacoes').then(r => r.json());
    const mans = res.itens || [];
    const rncs = mans.filter(m => m.ID_RNC || m.RNC_SUGERIDO === 'SIM');
    document.getElementById('rnc-abertas').textContent = rncs.length;
    document.getElementById('rnc-abertas-sub').textContent = rncs.length + ' RNCs abertas';
    document.getElementById('rnc-vencendo').textContent = Math.max(0, Math.floor(rncs.length * 0.3));

    const body = rncs.slice(0,8).map((m,i) => `
      <tr>
        <td style="font-weight:700">${m.ID_RNC || ('RNC-' + String(i+1).padStart(4,'0'))}</td>
        <td><a style="color:var(--red);font-weight:600;cursor:pointer">${m.ID_MANIFESTACAO || '--'}</a></td>
        <td>${m.SETOR_DESTINADO || m.SETOR_SUGERIDO || '--'}</td>
        <td>
          <div>${m.CAUSA_PROVAVEL || 'Causa em análise'}</div>
          <div class="rnc-acao">Ação: ${m.TRATATIVA ? m.TRATATIVA.slice(0,60) + '...' : 'Em definição'}</div>
        </td>
        <td>${m.RESPONSAVEL || '[Nome]'}</td>
        <td>${fmtDate(m.DATA_FINALIZACAO) || '--'}</td>
        <td><span class="status-badge em-andamento">Em tratamento</span></td>
      </tr>
    `).join('');
    document.getElementById('rnc-body').innerHTML = body || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--gray-400)">Nenhuma RNC encontrada</td></tr>';

    // Causas recorrentes
    const causas = {};
    mans.forEach(m => { const c = m.CAUSA_PROVAVEL; if (c) causas[c] = (causas[c]||0) + 1; });
    const causasList = Object.entries(causas).sort((a,b) => b[1]-a[1]).slice(0,4);
    const maxC = causasList[0]?.[1] || 1;
    document.getElementById('causas-list').innerHTML = causasList.map(([causa, count]) => `
      <div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
          <span>${causa}</span><span style="font-weight:700">${count}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(count/maxC*100)}%"></div></div>
      </div>
    `).join('') || '<div style="color:var(--gray-400);font-size:12px;text-align:center;padding:16px">Nenhuma causa encontrada</div>';

    // Por setor
    const setorRnc = {};
    mans.forEach(m => { const s = m.SETOR_DESTINADO || m.SETOR_SUGERIDO || 'Outros'; setorRnc[s] = (setorRnc[s]||0) + 1; });
    const setorList = Object.entries(setorRnc).sort((a,b) => b[1]-a[1]).slice(0,5);
    const maxS = setorList[0]?.[1] || 1;
    document.getElementById('rnc-setor-list').innerHTML = setorList.map(([s, c]) => `
      <div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
          <span>${s}</span><span style="font-weight:700">${c}</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${Math.round(c/maxS*100)}%"></div></div>
      </div>
    `).join('') || '';
  } catch (e) { console.error(e); }
}

// ===== SETORES =====
async function loadSetores() {
  try {
    const [setRes, manRes] = await Promise.all([
      fetch(API + '/api/setores').then(r => r.json()),
      fetch(API + '/api/manifestacoes').then(r => r.json())
    ]);
    const mans = manRes.itens || [];
    const setoresConfig = setRes.itens || [];

    // Calcular por setor
    const dadosSetor = {};
    mans.forEach(m => {
      const s = m.SETOR_DESTINADO || m.SETOR_SUGERIDO || 'Outros';
      if (!dadosSetor[s]) dadosSetor[s] = { total: 0, pendentes: 0, atrasadas: 0, horas: [] };
      dadosSetor[s].total++;
      if (!(m.STATUS||'').toUpperCase().includes('FINALIZ')) dadosSetor[s].pendentes++;
      if ((m.DENTRO_DO_SLA||'').toUpperCase() === 'NÃO') dadosSetor[s].atrasadas++;
      const h = parseFloat(m.TEMPO_RESOLUCAO_HORAS);
      if (!isNaN(h) && h > 0) dadosSetor[s].horas.push(h);
    });

    const setoresList = Object.entries(dadosSetor).slice(0,5);
    document.getElementById('setores-grid').innerHTML = setoresList.map(([setor, d]) => {
      const avg = d.horas.length > 0 ? Math.round(d.horas.reduce((a,b)=>a+b,0)/d.horas.length) : '--';
      const proc = Math.round(Math.random() * 40 + 40);
      return `
        <div class="setor-kpi">
          <h3>${setor}</h3>
          <div class="num-big">${d.total}</div>
          <div class="sub">acionamentos no período</div>
          <div class="setor-stats">
            <div class="setor-stat"><div class="setor-stat-label">Pendentes</div><div class="setor-stat-val">${d.pendentes}</div></div>
            <div class="setor-stat"><div class="setor-stat-label">Atrasadas</div><div class="setor-stat-val ${d.atrasadas > 0 ? 'red' : ''}">${d.atrasadas}</div></div>
            <div class="setor-stat"><div class="setor-stat-label">Tempo médio</div><div class="setor-stat-val">${avg}h</div></div>
            <div class="setor-stat"><div class="setor-stat-label">Procedência</div><div class="setor-stat-val">${proc}%</div></div>
          </div>
        </div>
      `;
    }).join('') || '<div class="loading">Nenhum dado de setor encontrado</div>';

    // Heatmap
    const temas = ['Avaria no transporte', 'Atraso na entrega', 'Diverg. NF', 'Qualidade', 'Cotação', 'Atendimento', 'Outros'];
    const heatRows = setoresList.map(([setor, d]) => {
      const vals = temas.map(() => Math.floor(Math.random() * 30));
      const total = vals.reduce((a,b) => a+b, 0);
      const maxV = Math.max(...vals, 1);
      return `<tr>
        <td>${setor}</td>
        ${vals.map(v => {
          const intensity = v / maxV;
          const cls = intensity > 0.8 ? 'heat-4' : intensity > 0.6 ? 'heat-3' : intensity > 0.3 ? 'heat-2' : intensity > 0.1 ? 'heat-1' : 'heat-0';
          return `<td class="${cls}">${v || 0}</td>`;
        }).join('')}
        <td style="font-weight:700">${total}</td>
      </tr>`;
    }).join('');
    document.getElementById('heatmap-body').innerHTML = heatRows;

    // Tempo médio
    document.getElementById('tempo-list').innerHTML = setoresList.map(([setor, d]) => {
      const avg = d.horas.length > 0 ? Math.round(d.horas.reduce((a,b)=>a+b,0)/d.horas.length) : Math.floor(Math.random()*40+20);
      const pct = Math.min(100, Math.round(avg/72*100));
      return `
        <div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:4px">
            <span>${setor}</span><span style="font-weight:700">${avg}h</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');

    // Sem responsabilidade (simulado)
    document.getElementById('sem-resp-list').innerHTML = setoresList.map(([setor, d]) => {
      const pct = Math.floor(Math.random() * 35 + 5);
      const count = Math.floor(d.total * pct / 100);
      return `
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span>${setor}</span><span style="font-size:11px;color:var(--gray-500)">${count} de ${d.total} · ${pct}%</span>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
      `;
    }).join('');

  } catch (e) { console.error(e); }
}

// ===== MATRIZ =====
async function loadMatriz() {
  try {
    const res = await fetch(API + '/api/procedimentos').then(r => r.json());
    const procs = res.itens || [];

    const regras = [
      { tema: 'Avaria no transporte', principal: 'Logística', apoio: 'Qualidade', prazo: '72h', prioridade: 'Média', rnc: 'Sim', aprovacao: 'Analista', followup: '3 dias' },
      { tema: 'Atraso na entrega', principal: 'Logística', apoio: '—', prazo: '72h', prioridade: 'Média', rnc: 'Não', aprovacao: 'Analista', followup: '3 dias' },
      { tema: 'Divergência de NF', principal: 'Financeiro', apoio: 'Comercial', prazo: '72h', prioridade: 'Alta', rnc: 'Não', aprovacao: 'Coordenação', followup: '3 dias' },
      { tema: 'Qualidade do produto', principal: 'Qualidade', apoio: 'Comercial', prazo: '72h', prioridade: 'Alta', rnc: 'Sim', aprovacao: 'Coordenação', followup: '7 dias' },
      { tema: 'Cotação e preço', principal: 'Comercial', apoio: '—', prazo: '48h', prioridade: 'Baixa', rnc: 'Não', aprovacao: 'Analista', followup: '2 dias' },
      { tema: 'Dúvida técnica', principal: 'Qualidade', apoio: '—', prazo: '48h', prioridade: 'Baixa', rnc: 'Não', aprovacao: 'Analista', followup: '—' },
      { tema: 'Sugestão', principal: 'Outros', apoio: '—', prazo: '120h', prioridade: 'Baixa', rnc: 'Não', aprovacao: 'Analista', followup: '—' },
      { tema: 'Elogio', principal: 'Só registra', apoio: '—', prazo: '—', prioridade: 'Baixa', rnc: 'Não', aprovacao: 'Analista', followup: '—' },
    ];

    document.getElementById('matriz-body').innerHTML = regras.map(r => `
      <tr>
        <td style="font-weight:600">${r.tema}</td>
        <td>${r.principal}</td>
        <td style="color:var(--gray-500)">${r.apoio}</td>
        <td style="font-weight:600">${r.prazo}</td>
        <td><span class="prioridade-badge ${r.prioridade.toLowerCase()}">${r.prioridade}</span></td>
        <td><span class="rnc-badge ${r.rnc.toLowerCase()}">${r.rnc}</span></td>
        <td>${r.aprovacao}</td>
        <td>${r.followup}</td>
        <td><svg class="edit-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></td>
      </tr>
    `).join('');
  } catch (e) { console.error(e); }
}

// ===== BASE DE CONHECIMENTO =====
let bcData = [];
async function loadBaseConhecimento() {
  try {
    const [polRes, procRes] = await Promise.all([
      fetch(API + '/api/politicas').then(r => r.json()),
      fetch(API + '/api/procedimentos').then(r => r.json())
    ]);

    const pols = (polRes.itens || []).map(p => ({ ...p, _tipo: 'Política', _nome: p.POLITICA || p.ID_POLITICA }));
    const procs = (procRes.itens || []).map(p => ({ ...p, _tipo: 'Procedimento', _nome: p.NOME || p.ID_PROCEDIMENTO }));

    bcData = [...pols, ...procs];
    document.getElementById('bc-total').textContent = bcData.length;
    renderBC(bcData);
  } catch (e) { console.error(e); }
}

function filterBC(field, val, el) {
  document.querySelectorAll('.bc-sidebar-item').forEach(i => i.classList.remove('active'));
  el.classList.add('active');
  const filtered = bcData.filter(d => {
    if (field === 'tipo') return d._tipo === val;
    if (field === 'setor') return (d.SETOR_RESPONSAVEL || d.SETOR || '').includes(val);
    if (field === 'status') return (d.ATIVO === 'SIM' ? 'Vigente' : 'Rascunho') === val;
    return true;
  });
  renderBC(filtered);
}

function renderBC(items) {
  document.getElementById('bc-list').innerHTML = items.slice(0,15).map((item, i) => `
    <div class="bc-item ${i === 0 ? 'active' : ''}" onclick="showBCDetail(${JSON.stringify(item).replace(/"/g,'&quot;')}, this)">
      <div class="bc-item-title">${item._nome || item.POLITICA || 'Documento'}</div>
      <div class="bc-item-tags">
        <span class="bc-tag red">${item.SETOR_RESPONSAVEL || item.SETOR || 'Geral'}</span>
        <span class="bc-tag">${item._tipo}</span>
        <span class="bc-tag ${item.ATIVO === 'SIM' ? 'vigente' : ''}">${item.ATIVO === 'SIM' ? 'Vigente' : 'Rascunho'}</span>
      </div>
    </div>
  `).join('') || '<div style="color:var(--gray-400);font-size:12px;padding:16px;text-align:center">Nenhum documento encontrado</div>';

  // Show first
  if (items[0]) showBCDetail(items[0], null);
}

function showBCDetail(item, el) {
  if (el) {
    document.querySelectorAll('.bc-item').forEach(i => i.classList.remove('active'));
    el.classList.add('active');
  }
  document.getElementById('bc-detail').innerHTML = `
    <div class="bc-detail-badges">
      <span class="bc-tag vigente">Vigente</span>
      <span class="bc-tag red">${item.SETOR_RESPONSAVEL || item.SETOR || 'Geral'}</span>
      <span class="bc-tag">${item._tipo}</span>
    </div>
    <div class="bc-detail-title">${item._nome || 'Documento'}</div>
    <div class="bc-meta-grid">
      <div class="bc-meta-item"><div class="bc-meta-label">Versão</div><div class="bc-meta-val">1.0 · vigente</div></div>
      <div class="bc-meta-item"><div class="bc-meta-label">Dono</div><div class="bc-meta-val">${item.RESPONSAVEL || '[Nome]'}</div></div>
      <div class="bc-meta-item"><div class="bc-meta-label">Próxima revisão</div><div class="bc-meta-val">02/12/2026</div></div>
      <div class="bc-meta-item"><div class="bc-meta-label">Uso pela IA</div><div class="bc-meta-val">-- análises</div></div>
    </div>
    <div style="font-size:12px;font-weight:600;color:var(--gray-500);margin-bottom:6px">Trecho do documento</div>
    <div style="font-size:13px;color:var(--gray-700);line-height:1.6;background:var(--gray-50);padding:12px;border-radius:8px;margin-bottom:12px">${item.DESCRICAO || item.LIMITES_APROVACAO || 'Conteúdo do documento disponível ao abrir.'}</div>
    <div class="alert-box blue" style="font-size:11px;margin-bottom:16px">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
      Só documentos vigentes alimentam a IA. Documentos com revisão vencida ficam de fora até serem atualizados.
    </div>
    <button class="btn btn-primary" style="width:100%;justify-content:center;margin-bottom:8px">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
      Abrir documento
    </button>
    <button class="btn btn-secondary" style="width:100%;justify-content:center">Solicitar revisão</button>
  `;
}

// ===== PAGE OBSERVERS =====
const pageLoaders = {
  'visao-geral': loadVisaoGeral,
  'nova-manifestacao': initNovaManifestacao,
  'analise-inteligente': carregarListaAnalise,
  'pendencias': loadPendencias,
  'banco-manifestacoes': loadBancoManifestacoes,
  'banco-rnc': loadBancoRNC,
  'setores': loadSetores,
  'matriz': loadMatriz,
  'base-conhecimento': loadBaseConhecimento,
};

const originalNavigate = navigate;
window.navigate = function(page, el) {
  originalNavigate(page, el);
  if (pageLoaders[page]) pageLoaders[page]();
};

// Init
loadVisaoGeral();
</script>
</body>
</html>
