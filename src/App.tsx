import React, { useState, useEffect, useMemo } from 'react';
import { Settings, Layers, Grid, Play, RotateCcw, Info, ChevronUp, ChevronDown, ChevronRight, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, ArrowUpCircle, ArrowDownCircle } from 'lucide-react';

/**
 * 定数・型定義
 */
const MODES = {
  PLAN: 'plan',       // 平面検討（複数層、上から見る）
  SECTION: 'section'  // 断面検討（単層、横から見る）
};

const THRESHOLDS = {
  SAFE: 60,      // 60分以内なら安全（青/緑）
  WARNING: 120,  // 120分以内なら注意（黄）
  DANGER: 121    // それ以上は危険（赤）
};

const COLORS = {
  PUMP_A: 'bg-blue-100 border-blue-300 text-blue-800',
  PUMP_B: 'bg-green-100 border-green-300 text-green-800',
  PUMP_C: 'bg-purple-100 border-purple-300 text-purple-800',
  PUMP_D: 'bg-orange-100 border-orange-300 text-orange-800',
  DEFAULT: 'bg-gray-50 border-gray-200 text-gray-400',
  SELECTED: 'ring-2 ring-offset-1 ring-blue-500',
};

// 方向定義
const DIRECTIONS = [
  { key: 'top', label: '上', dx: 0, dy: -1, dz: 0, icon: <ArrowUp className="w-3 h-3"/> },
  { key: 'bottom', label: '下', dx: 0, dy: 1, dz: 0, icon: <ArrowDown className="w-3 h-3"/> },
  { key: 'left', label: '左', dx: -1, dy: 0, dz: 0, icon: <ArrowLeft className="w-3 h-3"/> },
  { key: 'right', label: '右', dx: 1, dy: 0, dz: 0, icon: <ArrowRight className="w-3 h-3"/> },
  { key: 'upper', label: '上層', dx: 0, dy: 0, dz: 1, icon: <ArrowUpCircle className="w-3 h-3"/> },
  { key: 'lower', label: '下層', dx: 0, dy: 0, dz: -1, icon: <ArrowDownCircle className="w-3 h-3"/> },
];

const App = () => {
  // --- State: 基本設定 ---
  const [mode, setMode] = useState(MODES.PLAN);
  const [gridSize, setGridSize] = useState({ rows: 5, cols: 5, layers: 2 });
  
  // 行・列ごとのデフォルト寸法設定 (m)
  const [rowHeights, setRowHeights] = useState(Array(5).fill(1.0));
  const [colWidths, setColWidths] = useState(Array(5).fill(1.0));
  const [defaultDepth, setDefaultDepth] = useState(0.5); // 高さor奥行き

  // 打設速度 (m3/h) - ポンプごとに設定
  const [pourRates, setPourRates] = useState({
    A: 30,
    B: 30,
    C: 30,
    D: 30
  });
  
  // 寸法設定パネルの開閉
  const [showDimSettings, setShowDimSettings] = useState(false);

  // --- State: データ ---
  const [blocks, setBlocks] = useState({});
  const [activeLayer, setActiveLayer] = useState(0); // 0-indexed
  
  // --- State: 操作 ---
  const [currentTool, setCurrentTool] = useState({ 
    pump: 'A', 
    autoIncrement: true,
    manualOrder: 1 // 自動加算OFFのときや、表示用の手動値
  });
  
  // 現在のポンプのブロック数を計算して、次の番号を決定する
  const nextOrder = useMemo(() => {
    if (!currentTool.autoIncrement) return currentTool.manualOrder;
    
    // 現在のポンプで登録済みのブロック数をカウント
    const count = Object.values(blocks).filter(b => b.pump === currentTool.pump).length;
    return count + 1;
  }, [blocks, currentTool.pump, currentTool.autoIncrement, currentTool.manualOrder]);

  const [viewMode, setViewMode] = useState('input'); // 'input' | 'result'
  const [selectedCell, setSelectedCell] = useState(null);

  // --- Effect: 行列数が変わったら寸法配列をリサイズ ---
  useEffect(() => {
    setRowHeights(prev => {
      const next = [...prev];
      if (gridSize.rows > prev.length) {
        return [...next, ...Array(gridSize.rows - prev.length).fill(1.0)];
      }
      return next.slice(0, gridSize.rows);
    });
    setColWidths(prev => {
      const next = [...prev];
      if (gridSize.cols > prev.length) {
        return [...next, ...Array(gridSize.cols - prev.length).fill(1.0)];
      }
      return next.slice(0, gridSize.cols);
    });
  }, [gridSize.rows, gridSize.cols]);

  // --- 初期化 ---
  useEffect(() => {
    initializeGrid();
  }, [mode]);

  const initializeGrid = () => {
    const newBlocks = {};
    const layers = mode === MODES.SECTION ? 1 : gridSize.layers;
    
    for (let z = 0; z < layers; z++) {
      for (let y = 0; y < gridSize.rows; y++) {
        for (let x = 0; x < gridSize.cols; x++) {
          const id = `${z}-${y}-${x}`;
          const h = rowHeights[y] || 5.0;
          const w = colWidths[x] || 5.0;

          newBlocks[id] = {
            id, z, y, x,
            width: w,
            height: h,
            depth: defaultDepth,
            volume: parseFloat((w * h * defaultDepth).toFixed(2)),
            order: null, // ポンプごとのNo
            pump: null,  // A, B, C, D
            startTime: null,
            endTime: null,
            maxInterval: 0,
            neighborRisks: [] 
          };
        }
      }
    }
    setBlocks(newBlocks);
    setCurrentTool(prev => ({ ...prev }));
    setViewMode('input');
    setSelectedCell(null);
  };

  // --- 計算ロジック ---
  const calculateSimulation = () => {
    // ブロックをポンプごとに分け、それぞれのOrder順にソートして計算する
    const calculatedBlocks = { ...blocks };
    const pumps = ['A', 'B', 'C', 'D'];
    
    // 各ポンプの現在時刻（分）
    const pumpClocks = { A: 0, B: 0, C: 0, D: 0 };

    // 全体をリセット（未設定のものはnullに）
    Object.keys(calculatedBlocks).forEach(key => {
      calculatedBlocks[key].startTime = null;
      calculatedBlocks[key].endTime = null;
      calculatedBlocks[key].maxInterval = 0;
      calculatedBlocks[key].neighborRisks = [];
    });

    pumps.forEach(pumpId => {
       const rate = pourRates[pumpId] || 30; // m3/h

       // このポンプのブロックを取得してOrder順にソート
       const pumpBlocks = Object.values(calculatedBlocks)
         .filter(b => b.pump === pumpId && b.order !== null)
         .sort((a, b) => a.order - b.order);

       pumpBlocks.forEach(block => {
          const durationMinutes = (block.volume / rate) * 60;
          const startTime = pumpClocks[pumpId];
          const endTime = startTime + durationMinutes;

          calculatedBlocks[block.id] = {
            ...block,
            startTime,
            endTime
          };

          pumpClocks[pumpId] = endTime;
       });
    });

    // 2. 隣接打重ね時間（コールドジョイント）判定
    Object.keys(calculatedBlocks).forEach(key => {
      const current = calculatedBlocks[key];
      if (current.startTime === null) return;

      let maxDiff = 0;
      const risks = [];

      DIRECTIONS.forEach(dir => {
        if (mode === MODES.SECTION && dir.dz !== 0) return;

        const neighborId = `${current.z + dir.dz}-${current.y + dir.dy}-${current.x + dir.dx}`;
        const neighbor = calculatedBlocks[neighborId];

        if (neighbor && neighbor.endTime !== null && neighbor.startTime !== null) {
          
          let diff = 0;
          let description = '';
          
          // Case A: 自分が後、隣が先
          if (current.startTime >= neighbor.endTime) {
             diff = current.startTime - neighbor.endTime;
             description = `隣接(${neighbor.pump}-${neighbor.order})→自分`;
          }
          // Case B: 自分が先、隣が後
          else if (neighbor.startTime >= current.endTime) {
             diff = neighbor.startTime - current.endTime;
             description = `自分→隣接(${neighbor.pump}-${neighbor.order})`;
          }
          // Case C: 同時施工中（ラップしている）
          else {
             diff = 0;
             description = '同時施工';
          }

          if (diff > maxDiff) maxDiff = diff;

          risks.push({
            direction: dir.label,
            dirKey: dir.key,
            neighborOrder: neighbor.order,
            neighborPump: neighbor.pump,
            diff: diff,
            desc: description,
            isWorst: false 
          });
        }
      });

      risks.forEach(r => {
        if (r.diff === maxDiff && maxDiff > 0) r.isWorst = true;
      });

      calculatedBlocks[key].neighborRisks = risks;
      calculatedBlocks[key].maxInterval = maxDiff;
    });

    setBlocks(calculatedBlocks);
    setViewMode('result');
    setSelectedCell(null);
  };

  // --- イベントハンドラ ---
  const handleCellClick = (id) => {
    if (viewMode === 'result') {
      setSelectedCell(id);
      return;
    }

    setBlocks(prev => {
      const block = prev[id];
      
      // トグル動作：既に設定済みの場合は解除
      if (block.order !== null) {
          const updatedBlock = {
              ...block,
              order: null,
              pump: null
          };
          return { ...prev, [id]: updatedBlock };
      }

      // 未設定の場合は新規設定
      // 自動加算モードなら計算されたnextOrder、そうでなければ手動値
      const newOrder = nextOrder;

      const updatedBlock = {
        ...block,
        order: newOrder,
        pump: currentTool.pump
      };

      return { ...prev, [id]: updatedBlock };
    });

    setSelectedCell(id);
  };

  // ブロック属性（Orderなど）の直接変更
  const handleBlockAttributeChange = (id, field, value) => {
    setBlocks(prev => {
      const blk = prev[id];
      return { ...prev, [id]: { ...blk, [field]: value } };
    });
  };

  const handleBlockDimChange = (id, field, value) => {
    const val = parseFloat(value) || 0;
    setBlocks(prev => {
      const blk = prev[id];
      const newDims = { ...blk, [field]: val };
      newDims.volume = parseFloat((newDims.width * newDims.height * newDims.depth).toFixed(2));
      return { ...prev, [id]: newDims };
    });
  };

  const updateGlobalDim = (type, index, value) => {
    const val = parseFloat(value) || 0;
    if (type === 'row') {
      const newRows = [...rowHeights];
      newRows[index] = val;
      setRowHeights(newRows);
    } else {
      const newCols = [...colWidths];
      newCols[index] = val;
      setColWidths(newCols);
    }
  };

  // --- レンダリングヘルパー ---
  const calculateInterval = (b1, b2) => {
    if (!b1 || !b2 || b1.startTime === null || b2.startTime === null) return null;
    if (b1.startTime >= b2.endTime) return b1.startTime - b2.endTime;
    if (b2.startTime >= b1.endTime) return b2.startTime - b1.endTime;
    return 0; 
  };

  const getRiskColor = (minutes, isText = false) => {
    if (minutes === 0 || minutes === null) return isText ? 'text-blue-900' : 'bg-blue-50 text-blue-900';
    if (minutes <= THRESHOLDS.SAFE) return isText ? 'text-green-700' : 'bg-green-100 text-green-800 border-green-200';
    if (minutes <= THRESHOLDS.WARNING) return isText ? 'text-yellow-700' : 'bg-yellow-100 text-yellow-800 border-yellow-200';
    return isText ? 'text-red-700' : 'bg-red-500 text-white font-bold border-red-600';
  };

  const getBadgeColor = (minutes) => {
    if (minutes === 0) return 'bg-white border-gray-200 text-gray-400';
    if (minutes <= THRESHOLDS.SAFE) return 'bg-white border-green-400 text-green-700 shadow-sm';
    if (minutes <= THRESHOLDS.WARNING) return 'bg-yellow-50 border-yellow-400 text-yellow-700 shadow-sm';
    return 'bg-red-50 border-red-500 text-red-600 font-bold shadow-md';
  };

  const renderCell = (z, y, x) => {
    const id = `${z}-${y}-${x}`;
    const block = blocks[id];
    if (!block) return null;

    const isInputMode = viewMode === 'input';
    const isSelected = selectedCell === id;

    // 隣接ブロックデータの取得
    const rightBlock = blocks[`${z}-${y}-${x + 1}`];
    const bottomBlock = blocks[`${z}-${y + 1}-${x}`];
    
    // 直上層の取得
    let upperLayerInterval = null;
    if (mode === MODES.PLAN && !isInputMode) {
      const upperBlock = blocks[`${z+1}-${y}-${x}`];
      if (upperBlock && block.endTime !== null && upperBlock.startTime !== null) {
        if (upperBlock.startTime >= block.endTime) {
          upperLayerInterval = upperBlock.startTime - block.endTime;
        } else {
          upperLayerInterval = 0;
        }
      }
    }

    let bgClass = COLORS.DEFAULT;
    if (isInputMode) {
      // 入力モード: ポンプごとの色分け
      if (block.pump === 'A') bgClass = COLORS.PUMP_A;
      else if (block.pump === 'B') bgClass = COLORS.PUMP_B;
      else if (block.pump === 'C') bgClass = COLORS.PUMP_C;
      else if (block.pump === 'D') bgClass = COLORS.PUMP_D;
    } else {
      // 結果モード: リスクごとの色分け
      if (block.order === null) bgClass = 'bg-gray-200';
      else bgClass = getRiskColor(block.maxInterval);
    }

    const rightInterval = !isInputMode && rightBlock ? calculateInterval(block, rightBlock) : null;
    const bottomInterval = !isInputMode && bottomBlock ? calculateInterval(block, bottomBlock) : null;

    return (
      <div
        key={id}
        onClick={() => handleCellClick(id)}
        className={`
          relative border border-gray-400 cursor-pointer transition-all
          flex flex-col items-center justify-center p-0.5 text-xs select-none
          ${bgClass} ${isSelected ? COLORS.SELECTED : 'hover:opacity-80'}
        `}
        style={{ width: '100%', height: '100%', minHeight: '40px', zIndex: isSelected ? 20 : 1 }}
      >
        {/* Input Mode: Pump & No */}
        {isInputMode && block.order !== null && (
          <>
             {/* ポンプごとの連番を表示 */}
             <div className="flex flex-col items-center leading-none">
                <span className="text-[9px] opacity-70 mb-0.5">P-{block.pump}</span>
                <span className="font-bold text-sm">No.{block.order}</span>
             </div>
          </>
        )}

        {/* Result Mode: 直上打重ね時間（中央） */}
        {!isInputMode && block.order !== null && (
          <div className="flex flex-col items-center justify-center w-full h-full">
            {upperLayerInterval !== null && (
               <div className="flex flex-col items-center">
                 <span className={`text-[10px] font-bold ${upperLayerInterval > THRESHOLDS.WARNING ? 'text-white' : 'text-slate-600'} opacity-70`}>直上打重</span>
                 <span className={`text-lg font-black leading-none ${upperLayerInterval > THRESHOLDS.WARNING ? 'text-white drop-shadow-md' : 'text-slate-800'}`}>
                   {Math.round(upperLayerInterval)}
                 </span>
                 <span className={`text-[9px] ${upperLayerInterval > THRESHOLDS.WARNING ? 'text-white' : 'text-slate-600'}`}>min</span>
               </div>
            )}
            
            {/* 上への打重ねがない場合はNoを表示 */}
            {upperLayerInterval === null && (
               <div className="flex flex-col items-center opacity-80">
                 <span className="text-[9px]">{block.pump}</span>
                 <span className="text-xs font-bold">No.{block.order}</span>
               </div>
            )}
          </div>
        )}

        {/* 境界バッジ: 右 */}
        {rightInterval !== null && (
          <div 
            className={`absolute -right-3 top-1/2 transform -translate-y-1/2 z-10 px-1 py-0.5 rounded border text-[10px] font-mono font-bold leading-none ${getBadgeColor(rightInterval)}`}
            style={{ width: '24px', textAlign: 'center' }}
            title={`右隣との打重ね: ${Math.round(rightInterval)}分`}
          >
            {Math.round(rightInterval)}
          </div>
        )}

        {/* 境界バッジ: 下 */}
        {bottomInterval !== null && (
          <div 
            className={`absolute -bottom-2.5 left-1/2 transform -translate-x-1/2 z-10 px-1 py-0.5 rounded border text-[10px] font-mono font-bold leading-none ${getBadgeColor(bottomInterval)}`}
            style={{ minWidth: '24px', textAlign: 'center' }}
            title={`下隣との打重ね: ${Math.round(bottomInterval)}分`}
          >
            {Math.round(bottomInterval)}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col font-sans text-slate-800">
      {/* Header */}
      <header className="bg-slate-800 text-white p-3 shadow-md z-10">
        <div className="max-w-full mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Grid className="w-5 h-5" />
            <h1 className="text-lg font-bold">コンクリート打重ね計画支援</h1>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <div className="flex bg-slate-700 rounded p-1">
              <button
                onClick={() => setMode(MODES.PLAN)}
                className={`px-3 py-1 rounded transition-colors ${mode === MODES.PLAN ? 'bg-blue-500 text-white' : 'hover:bg-slate-600'}`}
              >
                平面検討
              </button>
              <button
                onClick={() => setMode(MODES.SECTION)}
                className={`px-3 py-1 rounded transition-colors ${mode === MODES.SECTION ? 'bg-blue-500 text-white' : 'hover:bg-slate-600'}`}
              >
                断面検討
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        
        {/* 左サイドバー：設定・入力 (スクロール可能) */}
        <div className="w-full lg:w-80 bg-white border-r border-gray-200 flex flex-col overflow-y-auto shadow-lg z-10">
          <div className="p-4 space-y-6">
            
            {/* 1. 基本設定 & 寸法設定 */}
            <div className="space-y-2">
              <h2 className="font-bold text-slate-700 flex items-center gap-2 text-sm border-b pb-1">
                <Settings className="w-4 h-4" /> 設定
              </h2>
              
              <div className="grid grid-cols-2 gap-2 text-xs">
                <label>
                  <span className="text-gray-500 block">タテ(行)</span>
                  <input type="number" min="1" max="20"
                    value={gridSize.rows}
                    onChange={(e) => setGridSize({ ...gridSize, rows: parseInt(e.target.value) || 1 })}
                    className="w-full border rounded px-2 py-1"
                  />
                </label>
                <label>
                  <span className="text-gray-500 block">ヨコ(列)</span>
                  <input type="number" min="1" max="20"
                    value={gridSize.cols}
                    onChange={(e) => setGridSize({ ...gridSize, cols: parseInt(e.target.value) || 1 })}
                    className="w-full border rounded px-2 py-1"
                  />
                </label>
                {mode === MODES.PLAN && (
                  <label>
                    <span className="text-gray-500 block">層数</span>
                    <input type="number" min="1" max="10"
                      value={gridSize.layers}
                      onChange={(e) => setGridSize({ ...gridSize, layers: parseInt(e.target.value) || 1 })}
                      className="w-full border rounded px-2 py-1"
                    />
                  </label>
                )}
              </div>
              
              {/* 打設速度設定 (ポンプ個別) */}
              <div className="mt-2 pt-2 border-t">
                 <span className="block text-gray-500 text-xs mb-1 font-bold">打設速度 (m³/h)</span>
                 <div className="grid grid-cols-2 gap-2">
                   {['A', 'B', 'C', 'D'].map(pump => (
                     <label key={pump} className="flex items-center gap-1">
                       <span className={`w-4 h-4 flex items-center justify-center text-[9px] font-bold rounded text-white ${
                         pump === 'A' ? 'bg-blue-500' : pump === 'B' ? 'bg-green-500' : pump === 'C' ? 'bg-purple-500' : 'bg-orange-500'
                       }`}>
                         {pump}
                       </span>
                       <input 
                         type="number" 
                         min="1"
                         value={pourRates[pump]}
                         onChange={(e) => setPourRates(prev => ({...prev, [pump]: parseFloat(e.target.value) || 30}))}
                         className="w-full border rounded px-1 py-0.5 text-xs"
                       />
                     </label>
                   ))}
                 </div>
              </div>

              {/* 寸法詳細設定アコーディオン */}
              <div className="border rounded bg-gray-50 mt-2">
                <button 
                  onClick={() => setShowDimSettings(!showDimSettings)}
                  className="w-full flex items-center justify-between p-2 text-xs font-bold text-gray-600 hover:bg-gray-100"
                >
                  <span>寸法詳細設定 (m)</span>
                  {showDimSettings ? <ChevronUp className="w-3 h-3"/> : <ChevronDown className="w-3 h-3"/>}
                </button>
                
                {showDimSettings && (
                  <div className="p-2 border-t text-xs space-y-3">
                    <div>
                       <span className="block font-bold text-gray-500 mb-1">各行の高さ (タテ)</span>
                       <div className="grid grid-cols-4 gap-1">
                         {rowHeights.map((h, i) => (
                           <div key={`r-${i}`} className="flex items-center gap-1">
                             <span className="text-gray-400 w-3">{i+1}:</span>
                             <input type="number" step="0.1" value={h} 
                               onChange={(e) => updateGlobalDim('row', i, e.target.value)}
                               className="w-full border rounded px-1" />
                           </div>
                         ))}
                       </div>
                    </div>
                    <div>
                       <span className="block font-bold text-gray-500 mb-1">各列の幅 (ヨコ)</span>
                       <div className="grid grid-cols-4 gap-1">
                         {colWidths.map((w, i) => (
                           <div key={`c-${i}`} className="flex items-center gap-1">
                             <span className="text-gray-400 w-3">{i+1}:</span>
                             <input type="number" step="0.1" value={w} 
                               onChange={(e) => updateGlobalDim('col', i, e.target.value)}
                               className="w-full border rounded px-1" />
                           </div>
                         ))}
                       </div>
                    </div>
                     <div>
                       <span className="block font-bold text-gray-500 mb-1">{mode === MODES.PLAN ? '層高さ' : '奥行き'} (共通)</span>
                       <input type="number" step="0.1" value={defaultDepth} 
                          onChange={(e) => setDefaultDepth(parseFloat(e.target.value) || 1)}
                          className="w-full border rounded px-2 py-1" />
                    </div>
                  </div>
                )}
              </div>

              <button 
                onClick={() => initializeGrid()} 
                className="w-full text-xs bg-slate-600 text-white py-2 rounded hover:bg-slate-700 flex items-center justify-center gap-2 mt-2"
              >
                <RotateCcw className="w-3 h-3"/> グリッド再生成
              </button>
            </div>

            {/* 2. 入力・実行 */}
            {viewMode === 'input' && (
              <div className="space-y-2 pt-4 border-t">
                <h2 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                  <Play className="w-4 h-4" /> 入力
                </h2>
                <div className="flex gap-2 justify-between">
                  {['A', 'B', 'C', 'D'].map(p => (
                    <button
                      key={p}
                      onClick={() => setCurrentTool(t => ({ ...t, pump: p }))}
                      className={`
                        w-10 h-10 rounded font-bold text-sm flex items-center justify-center shadow-sm relative
                        ${currentTool.pump === p ? 'ring-2 ring-blue-500 ring-offset-1 transform scale-105' : 'opacity-70 hover:opacity-100'}
                        ${p === 'A' ? COLORS.PUMP_A : p === 'B' ? COLORS.PUMP_B : p === 'C' ? COLORS.PUMP_C : COLORS.PUMP_D}
                      `}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-xs mt-2 bg-gray-50 p-2 rounded">
                  <span>Next No:</span>
                  <input
                    type="number"
                    value={nextOrder}
                    onChange={(e) => setCurrentTool({ ...currentTool, manualOrder: parseInt(e.target.value) || 1 })}
                    className={`w-16 border rounded px-2 py-1 font-bold ${currentTool.autoIncrement ? 'bg-gray-100 text-gray-500' : 'bg-white'}`}
                    readOnly={currentTool.autoIncrement}
                  />
                  <label className="flex items-center gap-1 cursor-pointer ml-auto">
                    <input
                      type="checkbox"
                      checked={currentTool.autoIncrement}
                      onChange={(e) => setCurrentTool({ ...currentTool, autoIncrement: e.target.checked })}
                    />
                    <span>自動加算(個数基準)</span>
                  </label>
                </div>
                <div className="text-[10px] text-gray-500 px-1">
                  ※ブロックをクリックで設定、再度クリックで解除
                </div>
                <button
                  onClick={calculateSimulation}
                  className="w-full mt-2 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-4 rounded shadow-md flex items-center justify-center gap-2 transition-transform active:scale-95"
                >
                  <Play className="w-4 h-4" /> 計算実行
                </button>
              </div>
            )}

            {/* 3. 結果表示 */}
            {viewMode === 'result' && (
              <div className="space-y-2 pt-4 border-t">
                <h2 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                  <Info className="w-4 h-4" /> 結果の見方
                </h2>
                <div className="space-y-1 text-xs">
                  <p className="font-bold text-gray-500 mb-1">[中央の数値]</p>
                  <p className="pl-2 mb-2 text-gray-600">直上層との打重ね時間（上層が来るまでの時間）</p>
                  
                  <p className="font-bold text-gray-500 mb-1">[境界のバッジ]</p>
                  <p className="pl-2 mb-2 text-gray-600">隣接ブロックとの打重ね時間</p>
                  
                  <div className="border-t pt-2 mt-2 space-y-1">
                    {[
                      { color: 'bg-green-100 border-green-400 text-green-700', label: `安全 (~${THRESHOLDS.SAFE}分)` },
                      { color: 'bg-yellow-50 border-yellow-400 text-yellow-700', label: `注意 (~${THRESHOLDS.WARNING}分)` },
                      { color: 'bg-red-50 border-red-500 text-red-600', label: `危険 (${THRESHOLDS.DANGER}分~)` },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <div className={`w-6 h-4 border rounded text-[9px] flex items-center justify-center font-bold ${item.color}`}>15</div>
                        <span>{item.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => setViewMode('input')}
                  className="w-full mt-4 bg-gray-500 hover:bg-gray-600 text-white py-2 px-4 rounded text-xs shadow"
                >
                  入力を修正する
                </button>
              </div>
            )}

            {/* 4. 選択ブロック詳細 */}
            {selectedCell && blocks[selectedCell] && (
              <div className="pt-4 border-t space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-300">
                 <h3 className="font-bold text-sm text-blue-800 bg-blue-50 p-1 rounded px-2 border-l-4 border-blue-500">
                   詳細情報
                 </h3>
                 <div className="text-xs space-y-2">
                    <div className="grid grid-cols-2 gap-2 bg-gray-50 p-2 rounded">
                      <div>
                        <span className="text-gray-500 block">Block ID</span>
                        <span className="font-mono font-bold">{blocks[selectedCell].id}</span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">打設順 / ポンプ</span>
                        <div className="flex items-center gap-1">
                          {blocks[selectedCell].order !== null ? (
                            <>
                              <span className="text-gray-500 font-bold">No.</span>
                              <input
                                type="number"
                                min="1"
                                className="border rounded px-1 w-14 font-bold text-slate-700 bg-white focus:ring-2 focus:ring-blue-300 outline-none"
                                value={blocks[selectedCell].order}
                                onChange={(e) => handleBlockAttributeChange(selectedCell, 'order', parseInt(e.target.value) || 1)}
                                onClick={(e) => e.stopPropagation()} 
                              />
                            </>
                          ) : (
                            <span className="font-bold">-</span>
                          )}
                          <span className="text-gray-400 mx-1">/</span>
                          <span className="font-bold">{blocks[selectedCell].pump ?? '-'}</span>
                        </div>
                      </div>
                      <div className="col-span-2 border-t border-gray-200 my-1"></div>
                      <div>
                        <span className="text-gray-500 block">寸法 (H×W×D)</span>
                        <span>{blocks[selectedCell].height}×{blocks[selectedCell].width}×{blocks[selectedCell].depth} m</span>
                      </div>
                      <div>
                         <span className="text-gray-500 block">容積</span>
                         <span>{blocks[selectedCell].volume} m³</span>
                      </div>
                    </div>

                    {/* 個別寸法調整 */}
                    <div className="space-y-1">
                      <span className="text-[10px] text-gray-500 font-bold">寸法調整</span>
                      <div className="grid grid-cols-3 gap-1">
                         <input type="number" className="border rounded px-1" placeholder="タテ"
                           value={blocks[selectedCell].height} onChange={(e) => handleBlockDimChange(selectedCell, 'height', e.target.value)} />
                         <input type="number" className="border rounded px-1" placeholder="ヨコ"
                           value={blocks[selectedCell].width} onChange={(e) => handleBlockDimChange(selectedCell, 'width', e.target.value)} />
                         <input type="number" className="border rounded px-1" placeholder="奥/高"
                           value={blocks[selectedCell].depth} onChange={(e) => handleBlockDimChange(selectedCell, 'depth', e.target.value)} />
                      </div>
                    </div>

                    {/* 隣接リスク詳細 */}
                    {viewMode === 'result' && blocks[selectedCell].neighborRisks && (
                      <div className="mt-4">
                        <h4 className="font-bold text-gray-700 mb-1 border-b pb-1">隣接打重ね時間 (分)</h4>
                        {blocks[selectedCell].neighborRisks.length === 0 ? (
                           <p className="text-gray-400 italic">隣接データなし</p>
                        ) : (
                          <div className="space-y-1">
                            {blocks[selectedCell].neighborRisks.map((risk, idx) => (
                              <div key={idx} className={`flex items-center justify-between p-1.5 rounded border ${risk.isWorst ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100'}`}>
                                <div className="flex items-center gap-2">
                                  <span className="p-1 bg-gray-100 rounded text-gray-600">{risk.icon}</span>
                                  <div>
                                    <div className="font-bold text-gray-700">{risk.direction} <span className="font-normal text-[10px] text-gray-500">({risk.neighborPump}-{risk.neighborOrder})</span></div>
                                    <div className="text-[9px] text-gray-400">{risk.desc}</div>
                                  </div>
                                </div>
                                <div className={`font-bold font-mono ${risk.diff > THRESHOLDS.WARNING ? 'text-red-600' : risk.diff > THRESHOLDS.SAFE ? 'text-yellow-600' : 'text-green-600'}`}>
                                  {Math.round(risk.diff)}min
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                 </div>
              </div>
            )}
          </div>
        </div>

        {/* メインエリア：グリッド表示 */}
        <div className="flex-1 bg-gray-100 flex flex-col overflow-hidden relative">
          
          {/* ツールバー */}
          <div className="bg-white p-2 border-b flex justify-between items-center shadow-sm z-10">
            <h3 className="font-bold text-slate-700 px-2 text-sm flex items-center gap-2">
               {mode === MODES.PLAN ? '平面ビュー (Plan)' : '断面ビュー (Section)'}
               {mode === MODES.PLAN && <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">複数層モード</span>}
            </h3>
            
            {mode === MODES.PLAN && (
              <div className="flex items-center gap-2 bg-gray-50 rounded-lg border px-2 py-1">
                <Layers className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-bold min-w-[80px] text-center">Layer {activeLayer + 1} / {gridSize.layers}</span>
                <div className="flex gap-1">
                   <button 
                     disabled={activeLayer <= 0}
                     onClick={() => setActiveLayer(l => l - 1)}
                     className="hover:bg-gray-200 p-1 rounded disabled:opacity-30 border"
                     title="下層へ"
                   >
                     <ChevronDown className="w-3 h-3" />
                   </button>
                   <button 
                     disabled={activeLayer >= gridSize.layers - 1}
                     onClick={() => setActiveLayer(l => l + 1)}
                     className="hover:bg-gray-200 p-1 rounded disabled:opacity-30 border"
                     title="上層へ"
                   >
                     <ChevronUp className="w-3 h-3" />
                   </button>
                </div>
              </div>
            )}
          </div>

          {/* グリッドキャンバス */}
          <div className="flex-1 overflow-auto p-8 relative flex items-center justify-center bg-slate-200">
             <div 
               className="bg-white shadow-xl p-4 border border-slate-300 relative"
             >
               {/* 列ヘッダー (幅表示) */}
               <div className="flex ml-8 mb-1">
                  {colWidths.map((w, i) => (
                    <div key={i} style={{ width: 80 }} className="text-center text-[10px] text-gray-500 border-b border-gray-300 pb-1">
                      {w}m
                    </div>
                  ))}
               </div>

               <div className="flex">
                 {/* 行ヘッダー (高さ表示) */}
                 <div className="flex flex-col mr-1 mt-1">
                    {rowHeights.map((h, i) => (
                      <div key={i} style={{ height: 60 }} className="flex items-center justify-end pr-2 text-[10px] text-gray-500 border-r border-gray-300">
                        {h}m
                      </div>
                    ))}
                 </div>

                 {/* グリッド本体 */}
                 <div 
                   className="grid gap-1 bg-gray-100 border p-1"
                   style={{
                     gridTemplateColumns: `repeat(${gridSize.cols}, 80px)`,
                     gridTemplateRows: `repeat(${gridSize.rows}, 60px)`,
                   }}
                 >
                   {Array.from({ length: gridSize.rows }).map((_, rIndex) => (
                     Array.from({ length: gridSize.cols }).map((_, cIndex) => 
                        renderCell(mode === MODES.SECTION ? 0 : activeLayer, rIndex, cIndex)
                     )
                   ))}
                 </div>
               </div>
             </div>
          </div>
          
          <div className="p-2 bg-white text-xs text-gray-500 border-t text-center shadow-[0_-2px_10px_rgba(0,0,0,0.05)]">
            {viewMode === 'input' 
              ? 'セルをクリックして打設順序を設定 (再クリックで解除) → [計算実行] でリスク解析' 
              : 'グリッド境界の数値は「隣接ブロックとの打重ね時間」を表します'}
          </div>
        </div>

      </main>
    </div>
  );
};

export default App;