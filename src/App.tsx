/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Stage, Layer, Rect, Circle, Line, Image as KonvaImage, Group, Text } from 'react-konva';
import { 
  Plus, 
  Settings, 
  Save, 
  RotateCcw, 
  Trash2, 
  Move, 
  Edit3, 
  X, 
  Check, 
  Palette,
  LayoutGrid,
  Image as ImageIcon,
  Menu as MenuIcon,
  Sun,
  Moon
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useWindowSize } from 'react-use';
import { SceneState, INITIAL_STATE, SceneElement, ElementType, ShapeType } from './types';
import { formatDistance, getGridConfig, COLORS } from './utils';

const isDark = (color: string) => {
  if (!color) return true;
  const hex = color.replace('#', '');
  if (hex.length < 6) return true;
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness < 128;
};

const MAP_LIMIT = 250000; // 250km from origin (500km total)
const MAX_SCALE = 10000;  // 10mm = 0.01m. 100px/0.01m = 10000
const MIN_SCALE = 0.0005; 

const ITEM_COLORS = [
  '#ef4444', // Vermelho
  '#f97316', // Laranja
  '#eab308', // Amarelo
  '#22c55e', // Verde
  '#3b82f6', // Azul
  '#a855f7'  // Roxo
];

// --- Internal Components defined at bottom ---

export default function App() {
  const { width: windowWidth, height: windowHeight } = useWindowSize();
  const [state, setState] = useState<SceneState>(() => {
    const saved = localStorage.getItem('rpg_map_state');
    return saved ? JSON.parse(saved) : INITIAL_STATE;
  });

  // Camera state
  const [scale, setScale] = useState(50); // pixels per meter
  const [offset, setOffset] = useState({ x: windowWidth / 2, y: windowHeight / 2 });
  
  // Interaction state
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mode, setMode] = useState<'view' | 'edit' | 'move'>('view');
  const [popupPos, setPopupPos] = useState<{ x: number, y: number } | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [bgType, setBgType] = useState<'color' | 'image'>('color');
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [forcedGridColor, setForcedGridColor] = useState<'auto' | 'light' | 'dark'>('auto');
  const [isPanning, setIsPanning] = useState(false);
  const [lastPointerPos, setLastPointerPos] = useState({ x: 0, y: 0 });

  // Add Item States
  const [addItemType, setAddItemType] = useState<string>('point');
  const [addFillType, setAddFillType] = useState<'color' | 'image'>('color');
  const [addColor, setAddColor] = useState(ITEM_COLORS[0]);
  const [addImage, setAddImage] = useState('');
  const [addOpacity, setAddOpacity] = useState(1);
  const [addError, setAddError] = useState<string | null>(null);

  // Background Dimension Popup States
  const [showBgPopup, setShowBgPopup] = useState(false);
  const [pendingBgUrl, setPendingBgUrl] = useState('');
  const [bgWidth, setBgWidth] = useState('20');
  const [bgHeight, setBgHeight] = useState('20');

  const stageRef = useRef<any>(null);

  // Calculate grid color
  const gridTheme = useMemo(() => {
    if (forcedGridColor !== 'auto') return forcedGridColor;
    if (state.background.image) return 'dark'; // default for images if not forced
    return isDark(state.background.color) ? 'dark' : 'light';
  }, [forcedGridColor, state.background.image, state.background.color]);

  // Persistence
  const saveState = () => {
    localStorage.setItem('rpg_map_state', JSON.stringify(state));
    alert('Sessão salva com sucesso!');
  };

  const loadState = () => {
    const saved = localStorage.getItem('rpg_map_state');
    if (saved) {
      setState(JSON.parse(saved));
    }
  };

  // Convert Screen -> World (Meters)
  const screenToWorld = (screenX: number, screenY: number) => {
    return {
      x: (screenX - offset.x) / scale,
      y: (screenY - offset.y) / scale
    };
  };

  const handleWheel = (e: any) => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;

    const nativeEvent = e.evt;
    const isZoom = nativeEvent.ctrlKey;
    const isHorizontalPan = nativeEvent.shiftKey;

    if (isZoom) {
      const oldScale = scale;
      const pointer = stage.getPointerPosition();
      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - offset.x) / oldScale,
        y: (pointer.y - offset.y) / oldScale,
      };

      let newScale = nativeEvent.deltaY < 0 ? oldScale * 1.1 : oldScale / 1.1;
      
      if (newScale < MIN_SCALE) newScale = MIN_SCALE;
      if (newScale > MAX_SCALE) newScale = MAX_SCALE;

      const newOffset = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      const clampedX = Math.min(Math.max(newOffset.x, windowWidth / 2 - MAP_LIMIT * newScale), windowWidth / 2 + MAP_LIMIT * newScale);
      const clampedY = Math.min(Math.max(newOffset.y, windowHeight / 2 - MAP_LIMIT * newScale), windowHeight / 2 + MAP_LIMIT * newScale);

      setScale(newScale);
      setOffset({ x: clampedX, y: clampedY });
    } else {
      // Pan logic - Smoothed by reducing delta
      const sensitivity = 0.4;
      const moveX = isHorizontalPan ? -nativeEvent.deltaY * sensitivity : -nativeEvent.deltaX * sensitivity;
      const moveY = isHorizontalPan ? 0 : -nativeEvent.deltaY * sensitivity;

      setOffset(prev => {
        const newX = prev.x + moveX;
        const newY = prev.y + moveY;
        
        const clampedX = Math.min(Math.max(newX, windowWidth / 2 - MAP_LIMIT * scale), windowWidth / 2 + MAP_LIMIT * scale);
        const clampedY = Math.min(Math.max(newY, windowHeight / 2 - MAP_LIMIT * scale), windowHeight / 2 + MAP_LIMIT * scale);
        
        return { x: clampedX, y: clampedY };
      });
    }
  };

  const handleMouseDown = (e: any) => {
    // Only pan if we're not clicking an element and mode is view
    if (e.target === e.target.getStage() && mode === 'view' && !isSidebarOpen) {
      setIsPanning(true);
      const pos = e.target.getStage().getPointerPosition();
      setLastPointerPos(pos || { x: 0, y: 0 });
    }
  };

  const handleMouseMove = (e: any) => {
    if (!isPanning || mode === 'move') return;
    const stage = stageRef.current;
    if (!stage) return;
    const pointerPos = stage.getPointerPosition();
    if (!pointerPos) return;

    const dx = pointerPos.x - lastPointerPos.x;
    const dy = pointerPos.y - lastPointerPos.y;

    setLastPointerPos(pointerPos);
    setOffset(prev => {
      const newX = prev.x + dx;
      const newY = prev.y + dy;
      const clampedX = Math.min(Math.max(newX, windowWidth / 2 - MAP_LIMIT * scale), windowWidth / 2 + MAP_LIMIT * scale);
      const clampedY = Math.min(Math.max(newY, windowHeight / 2 - MAP_LIMIT * scale), windowHeight / 2 + MAP_LIMIT * scale);
      return { x: clampedX, y: clampedY };
    });
  };

  const handleMouseUp = () => {
    setIsPanning(false);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't move if user is typing in an input or textarea
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') {
        return;
      }

      const step = 40; // Pixels per key press
      let dx = 0;
      let dy = 0;

      if (e.key === 'ArrowLeft') dx = step;
      if (e.key === 'ArrowRight') dx = -step;
      if (e.key === 'ArrowUp') dy = step;
      if (e.key === 'ArrowDown') dy = -step;

      if (dx !== 0 || dy !== 0) {
        setOffset(prev => {
          const newX = prev.x + dx;
          const newY = prev.y + dy;
          const clampedX = Math.min(Math.max(newX, windowWidth / 2 - MAP_LIMIT * scale), windowWidth / 2 + MAP_LIMIT * scale);
          const clampedY = Math.min(Math.max(newY, windowHeight / 2 - MAP_LIMIT * scale), windowHeight / 2 + MAP_LIMIT * scale);
          return { x: clampedX, y: clampedY };
        });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [scale, windowWidth, windowHeight]);

  const addElement = () => {
    if ((addItemType === 'point' || addItemType === 'line') && addFillType === 'image') {
      setAddError("Pontos e Linhas não podem ser inseridos com imagens. Use outra forma.");
      setTimeout(() => setAddError(null), 3000);
      return;
    }

    const worldCenter = screenToWorld(windowWidth / 2, windowHeight / 2);
    const newEl: any = {
      id: Math.random().toString(36).substr(2, 9),
      x: worldCenter.x,
      y: worldCenter.y,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      opacity: addOpacity,
      name: `${addItemType} ${state.elements.length + 1}`,
    };

    if (addItemType === 'point') {
      newEl.type = 'point';
      newEl.radius = 0.5; // Small circle
      newEl.color = addColor;
    } else if (addItemType === 'line') {
      newEl.type = 'line';
      newEl.points = [0, 0, 2, 2]; // 2 meter diagonal line
      newEl.color = addColor;
      newEl.strokeWidth = 0.1;
    } else if (addItemType === 'quadrado' || addItemType === 'retangulo' || addItemType === 'circulo_vazado') {
      newEl.type = 'shape';
      newEl.stroke = addItemType === 'circulo_vazado' ? addColor : '#000000';
      newEl.strokeWidth = addItemType === 'circulo_vazado' ? 0.15 : 0.05;
      newEl.shapeType = addItemType === 'circulo_vazado' ? 'circle' : 'rectangle';
      
      if (addFillType === 'image') {
        newEl.type = 'image';
        newEl.src = addImage || 'https://picsum.photos/400';
        newEl.width = addItemType === 'quadrado' ? 2 : (addItemType === 'circulo_vazado' ? 3 : 4);
        newEl.height = addItemType === 'quadrado' ? 2 : (addItemType === 'circulo_vazado' ? 3 : 2);
      } else {
        newEl.width = addItemType === 'quadrado' ? 2 : (addItemType === 'circulo_vazado' ? 3 : 4);
        newEl.height = addItemType === 'quadrado' ? 2 : (addItemType === 'circulo_vazado' ? 3 : 2);
        newEl.fill = addItemType === 'circulo_vazado' ? 'transparent' : addColor;
        newEl.color = addColor;
      }
    }

    setState(prev => ({
      ...prev,
      elements: [...prev.elements, newEl]
    }));
    setSelectedId(newEl.id);
    setMode('edit');
    setIsSidebarOpen(false);
  };

  const updateElement = (id: string, updates: Partial<SceneElement>) => {
    setState(prev => ({
      ...prev,
      elements: prev.elements.map(el => el.id === id ? { ...el, ...updates } as any : el)
    }));
  };

  const deleteElement = (id: string) => {
    setState(prev => ({
      ...prev,
      elements: prev.elements.filter(el => el.id !== id)
    }));
    setSelectedId(null);
    setMode('view');
  };

  const handleElementClick = (e: any, id: string) => {
    e.cancelBubble = true;
    setSelectedId(id);
    setMode('move');
    setPopupPos(null);
  };

  const handleElementContextMenu = (e: any, id: string) => {
    e.evt.preventDefault();
    e.cancelBubble = true;
    setSelectedId(id);
    setMode('view');
    const stage = stageRef.current;
    if (stage) {
      const pointer = stage.getPointerPosition();
      if (pointer) {
        setPopupPos({ x: pointer.x, y: pointer.y });
      }
    }
  };

  const handleApplyBackground = () => {
    const input = document.getElementById('bg-url-input') as HTMLInputElement;
    if (input && input.value) {
      setPendingBgUrl(input.value);
      setShowBgPopup(true);
    }
  };

  const confirmBackground = () => {
    setState(s => ({ 
      ...s, 
      background: { 
        ...s.background, 
        image: pendingBgUrl,
        width: parseFloat(bgWidth) || 20,
        height: parseFloat(bgHeight) || 20
      } 
    }));
    setShowBgPopup(false);
    setIsSidebarOpen(false);
  };

  const calculateLineDistance = (points: number[]) => {
    if (points.length < 4) return 0;
    const dx = points[2] - points[0];
    const dy = points[3] - points[1];
    return Math.sqrt(dx * dx + dy * dy);
  };

  const gridConfig = useMemo(() => getGridConfig(scale), [scale]);

  const selectedElement = useMemo(() => 
    state.elements.find(el => el.id === selectedId), 
    [state.elements, selectedId]
  );

  return (
    <div className="relative w-full h-screen overflow-hidden bg-[#121212] font-sans">
      {/* Background Layer */}
      <div 
        className={`absolute inset-0 transition-colors duration-500 ${mode === 'move' ? 'bg-[#1a1a1a]' : ''}`}
        style={{ backgroundColor: mode === 'move' ? undefined : state.background.color }}
      />

      <Stage
        width={windowWidth}
        height={windowHeight}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        ref={stageRef}
        onClick={(e) => { 
          if (!isPanning) {
            setSelectedId(null); 
            setMode('view');
          }
        }}
        className={`cursor-crosshair ${isPanning ? 'active:cursor-grabbing' : ''}`}
      >
        <Layer>
          {state.background.image && state.background.image !== '' && (
            <BackgroundImage 
              src={state.background.image} 
              width={state.background.width || 20} 
              height={state.background.height || 20}
              scale={scale}
              offset={offset}
              opacity={mode === 'move' ? 0.1 : (state.background.opacity ?? 1)}
            />
          )}

          {state.background.gridVisible && (
            <GridLayer 
              scale={scale} 
              offset={offset} 
              width={windowWidth} 
              height={windowHeight} 
              config={gridConfig} 
              isDimmed={mode === 'move'}
              gridTheme={gridTheme}
            />
          )}

          {state.elements.map(el => (
            <CanvasElement 
              key={el.id} 
              element={el as any} 
              scale={scale} 
              offset={offset} 
              isSelected={selectedId === el.id}
              mode={mode}
              onClick={(e: any) => handleElementClick(e, el.id)}
              onContextMenu={(e: any) => handleElementContextMenu(e, el.id)}
              onUpdate={(updates: any) => updateElement(el.id, updates)}
            />
          ))}
        </Layer>
      </Stage>

      {/* Axis Information */}
      <div className="absolute bottom-6 left-6 p-3 sm:p-4 bg-white/10 backdrop-blur-xl rounded-2xl text-white font-mono text-[10px] sm:text-xs pointer-events-none border border-white/20 shadow-2xl max-w-[calc(100vw-3rem)]">
        <div className="flex flex-col gap-1">
          <div className="flex justify-between gap-4 opacity-60 uppercase tracking-tighter shrink-0"><span>Escala Grade:</span> <span>{formatDistance(gridConfig.step)}</span></div>
          <div className="flex justify-between gap-4 opacity-60 uppercase tracking-tighter shrink-0"><span>Definição:</span> <span>{(scale).toFixed(1)} px/m</span></div>
        </div>
      </div>

      {/* Controls Overlay */}
      <div className="absolute top-6 left-6 flex flex-col gap-4 z-50">
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className={`p-4 shadow-2xl rounded-2xl transition-all active:scale-95 flex items-center justify-center ${isSidebarOpen ? (theme === 'dark' ? 'bg-[#1e1e1e] text-gray-500' : 'bg-white text-gray-400') : 'bg-[#4D2C19] text-white'}`}
          id="btn-sidebar-toggle"
        >
          {isSidebarOpen ? <X size={24} /> : <MenuIcon size={24} />}
        </button>
      </div>

      {/* Grid Color Toggle - Available when sidebar is open or when using image bg */}
      {state.background.gridVisible && (isSidebarOpen || bgType === 'image') && (
        <div className={`absolute bottom-6 right-6 z-50 transition-all ${isSidebarOpen ? 'translate-x-0' : 'translate-x-0'}`}>
          <button 
            onClick={() => setForcedGridColor(gridTheme === 'dark' ? 'light' : 'dark')}
            className={`flex items-center gap-2 p-4 rounded-2xl shadow-2xl transition-all active:scale-95 border ${theme === 'dark' ? 'bg-[#1e1e1e] border-white/10 text-white' : 'bg-white border-gray-200 text-gray-800'}`}
            title="Alternar Cor da Grade"
          >
            <LayoutGrid size={20} className={gridTheme === 'dark' ? 'text-white' : 'text-gray-900'} />
            <span className="text-xs font-bold uppercase tracking-widest">{gridTheme === 'dark' ? 'Grade Branca' : 'Grade Preta'}</span>
          </button>
        </div>
      )}

      {/* Pop-up Menu */}
      <AnimatePresence>
        {popupPos && selectedId && mode === 'view' && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.9, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            style={{ left: popupPos.x, top: popupPos.y - 100 }}
            className={`absolute z-50 flex flex-col overflow-hidden shadow-2xl rounded-2xl border -translate-x-1/2 ${theme === 'dark' ? 'bg-[#1e1e1e] border-white/10 text-white' : 'bg-white border-gray-100 text-gray-800'}`}
          >
            <button 
              onClick={() => { setMode('edit'); setShowEditModal(true); setPopupPos(null); }}
              className={`flex items-center gap-3 px-6 py-4 font-semibold transition-colors border-b ${theme === 'dark' ? 'hover:bg-white/5 border-white/5' : 'hover:bg-gray-50 border-gray-100'}`}
            >
              <Edit3 size={18} className="text-[#4D2C19]" /> Editar
            </button>
            <div className={`flex ${theme === 'dark' ? 'bg-black/20' : 'bg-transparent'}`}>
               <button 
                onClick={() => deleteElement(selectedId)}
                className={`flex-1 flex justify-center py-4 transition-colors ${theme === 'dark' ? 'hover:bg-red-950/30' : 'hover:bg-red-50'} text-red-600`}
                title="Excluir"
              >
                <Trash2 size={18} />
              </button>
              <button 
                onClick={() => { setSelectedId(null); setPopupPos(null); }}
                className={`flex-1 flex justify-center py-4 transition-colors ${theme === 'dark' ? 'hover:bg-white/5 text-gray-500' : 'hover:bg-gray-100 text-gray-400'}`}
              >
                <X size={18} />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

        {/* Mode Status (Moving/Editing) */}
        {(mode === 'edit' || mode === 'move') && (
          <div className="absolute inset-x-0 bottom-0 pointer-events-none flex items-end justify-center pb-6 sm:pb-12 z-50">
            <motion.div 
              initial={{ y: 50, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              className={`pointer-events-auto flex flex-col sm:flex-row items-center gap-4 sm:gap-6 p-5 sm:p-6 shadow-[0_0_50px_rgba(0,0,0,0.2)] rounded-[2rem] sm:rounded-[2.5rem] border mx-4 ${theme === 'dark' ? 'bg-[#1a1a1a] border-white/10' : 'bg-white border-gray-100'}`}
            >
              <div className={`flex flex-col pr-0 sm:pr-4 border-b sm:border-b-0 sm:border-r pb-3 sm:pb-0 w-full sm:w-auto text-center sm:text-left ${theme === 'dark' ? 'border-white/5' : 'border-gray-100'}`}>
                <span className="text-[10px] font-black text-[#5D3C29] uppercase tracking-widest mb-1 leading-none">
                  {mode === 'edit' ? 'Editar Objeto' : 'Modo de Movimentação'}
                </span>
                <span className={`text-base sm:text-lg font-bold leading-none ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>
                  {selectedElement?.name || 'Elemento'}
                </span>
              </div>
              <div className="flex gap-3 w-full sm:w-auto">
                <button 
                  onClick={() => setMode('view')}
                  className={`flex-1 sm:px-8 py-3 sm:py-4 rounded-2xl sm:rounded-3xl font-bold transition-all active:scale-95 ${theme === 'dark' ? 'bg-white/5 text-gray-300 hover:bg-white/10' : 'bg-gray-100 text-gray-800 hover:bg-gray-200'}`}
                >
                  Cancelar
                </button>
                <button 
                  onClick={() => setMode('view')}
                  className="flex-[2] sm:px-8 py-3 sm:py-4 bg-[#4D2C19] hover:bg-[#3D2213] rounded-2xl sm:rounded-3xl text-white font-bold transition-all shadow-xl shadow-black/10 active:scale-95 flex items-center justify-center gap-2"
                >
                  <Check size={20} /> Salvar
                </button>
              </div>
            </motion.div>
          </div>
        )}

      {/* Sidebar Navigation */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ x: -400 }}
            animate={{ x: 0 }}
            exit={{ x: -400 }}
            className="absolute left-0 top-0 bottom-0 flex z-[60]"
          >
            <div className={`w-full sm:w-[22rem] h-full shadow-[20px_0_60px_rgba(0,0,0,0.1)] p-6 sm:p-8 flex flex-col gap-8 overflow-y-auto ${theme === 'dark' ? 'bg-[#141414] text-white' : 'bg-white text-gray-900'}`}>
              <div className="mt-16 flex flex-col gap-6">
                {/* Theme Toggle Above Name */}
                <div className="flex justify-start">
                  <button 
                    onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
                    className={`flex items-center gap-2 p-2 px-3 rounded-xl transition-all ${theme === 'dark' ? 'bg-white/5 text-yellow-400 border border-white/10' : 'bg-gray-100 text-gray-500 border border-gray-200'}`}
                  >
                    {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
                    <span className="text-[10px] font-black uppercase tracking-widest">{theme === 'dark' ? 'Claro' : 'Escuro'}</span>
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-[#4D2C19] rounded-2xl flex items-center justify-center text-white font-black text-xl italic shadow-lg shadow-black/20">C</div>
                    <h2 className={`text-2xl font-black italic tracking-tighter ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`}>Chronicle</h2>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={saveState} className={`p-3 rounded-2xl transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-gray-400' : 'bg-gray-50 hover:bg-gray-100 text-gray-600'}`} title="Salvar"><Save size={20}/></button>
                    <button onClick={loadState} className={`p-3 rounded-2xl transition-colors ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 text-gray-400' : 'bg-gray-50 hover:bg-gray-100 text-gray-600'}`} title="Carregar"><RotateCcw size={20}/></button>
                  </div>
                </div>
              </div>

            {/* Background Settings */}
            <section className="space-y-6">
              <div className={`flex items-center gap-3 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                <Palette size={18} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Cenário</h3>
              </div>
              <div className={`flex p-1.5 rounded-[1.25rem] ${theme === 'dark' ? 'bg-black/40' : 'bg-gray-100'}`}>
                <button 
                  onClick={() => setBgType('color')}
                  className={`flex-1 py-3 text-xs font-bold rounded-2xl transition-all ${bgType === 'color' ? (theme === 'dark' ? 'bg-[#4D2C19] text-white shadow-sm' : 'bg-white text-[#4D2C19] shadow-sm') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-400' : 'text-gray-500 hover:text-gray-700')}`}
                >Cores</button>
                <button 
                  onClick={() => setBgType('image')}
                  className={`flex-1 py-3 text-xs font-bold rounded-2xl transition-all ${bgType === 'image' ? (theme === 'dark' ? 'bg-[#4D2C19] text-white shadow-sm' : 'bg-white text-[#4D2C19] shadow-sm') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-400' : 'text-gray-500 hover:text-gray-700')}`}
                >Imagem</button>
              </div>
              {bgType === 'color' ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-6 gap-2">
                    {COLORS.slice(0, 6).map(c => (
                      <button 
                        key={c}
                        onClick={() => setState(s => ({ ...s, background: { ...s.background, color: c } }))}
                        className={`w-full aspect-square rounded-xl border-4 transition-all hover:scale-105 active:scale-95 ${state.background.color === c ? 'border-[#4D2C19] shadow-lg shadow-black/5' : 'border-transparent shadow-sm'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <div className="relative">
                    <input 
                      type="color" 
                      id="bg-color-picker"
                      className="absolute inset-0 opacity-0 w-full h-full cursor-pointer pointer-events-none"
                      value={state.background.color}
                      onChange={(e) => setState(s => ({ ...s, background: { ...s.background, color: e.target.value } }))}
                    />
                    <button 
                      onClick={() => document.getElementById('bg-color-picker')?.click()}
                      className={`w-full py-3 font-bold text-xs rounded-xl border border-dashed transition-all active:scale-95 flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                    >
                      <Palette size={14} /> Selecionar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>URL da Imagem</label>
                    <input 
                      type="text" 
                      id="bg-url-input"
                      placeholder="Ex: https://map.jpg"
                      className={`w-full px-6 py-3 border-2 border-transparent transition-all focus:outline-none text-sm rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19] focus:bg-black/60 placeholder:text-gray-700' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19] focus:bg-white placeholder:text-gray-300'}`}
                      defaultValue={state.background.image || ''}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Upload Local</label>
                    <input 
                      type="file" 
                      id="bg-file-input"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const reader = new FileReader();
                          reader.onload = (ev) => {
                            const res = ev.target?.result as string;
                            if (res) {
                              const urlInput = document.getElementById('bg-url-input') as HTMLInputElement;
                              if (urlInput) urlInput.value = res;
                            }
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                    />
                    <button 
                      onClick={() => document.getElementById('bg-file-input')?.click()}
                      className={`w-full py-3 font-bold text-xs rounded-xl border border-dashed transition-all flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                    >
                      <ImageIcon size={14} /> Escolher Arquivo
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex justify-between items-center">
                      <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Transparência da Imagem</label>
                      <span className={`text-[10px] font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                        {Math.round((state.background.opacity ?? 1) * 100)}%
                      </span>
                    </div>
                    <input 
                      type="range" min="0" max="1" step="0.05"
                      value={state.background.opacity ?? 1}
                      onChange={(e) => setState(s => ({ ...s, background: { ...s.background, opacity: parseFloat(e.target.value) } }))}
                      className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#4D2C19]"
                    />
                  </div>

                  <div className="flex gap-2">
                    <button 
                      onClick={handleApplyBackground}
                      className="flex-1 py-4 bg-[#4D2C19] hover:bg-[#3D2213] text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-black/10 active:scale-95"
                    >
                      Aplicar
                    </button>
                    <button 
                      onClick={() => {
                        setState(s => ({ ...s, background: { ...s.background, image: '' } }));
                        setBgType('color');
                      }}
                      className={`flex-1 py-4 border-2 font-bold text-sm rounded-2xl transition-all active:scale-95 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-white hover:bg-white/10' : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'}`}
                    >
                      Remover
                    </button>
                  </div>
                </div>
              )}
              <label className={`flex items-center gap-4 p-5 rounded-[1.5rem] cursor-pointer hover:bg-gray-100 transition-all border border-transparent hover:border-gray-200 ${theme === 'dark' ? 'bg-white/5 hover:bg-white/10 hover:border-white/10' : 'bg-gray-50 hover:bg-gray-100 hover:border-gray-200'}`}>
                <input 
                  type="checkbox" 
                  checked={state.background.gridVisible}
                  onChange={(e) => setState(s => ({ ...s, background: { ...s.background, gridVisible: e.target.checked } }))}
                  className="w-6 h-6 rounded-lg text-[#4D2C19] border-gray-300 focus:ring-0 cursor-pointer"
                />
                <span className={`text-sm font-bold ${theme === 'dark' ? 'text-gray-300' : 'text-gray-700'}`}>Mostrar Grade Métrica</span>
                <LayoutGrid size={18} className="ml-auto text-gray-300" />
              </label>
            </section>

            {/* Element Creation */}
            <section className="space-y-6">
              <div className={`flex items-center gap-3 ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>
                <Plus size={18} />
                <h3 className="text-xs font-black uppercase tracking-[0.2em]">Adicionar Item</h3>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Tipo de Forma</label>
                  <select 
                    value={addItemType}
                    onChange={(e) => setAddItemType(e.target.value)}
                    className={`w-full px-5 py-3 border-2 border-transparent transition-all focus:outline-none text-sm rounded-2xl cursor-pointer ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                  >
                    <option value="point">Ponto</option>
                    <option value="line">Linha</option>
                    <option value="quadrado">Quadrado</option>
                    <option value="retangulo">Retângulo</option>
                    <option value="circulo_vazado">Círculo (Vazado)</option>
                  </select>
                </div>

                <div className={`flex p-1.5 rounded-[1.25rem] ${theme === 'dark' ? 'bg-black/40' : 'bg-gray-100'}`}>
                  <button 
                    onClick={() => setAddFillType('color')}
                    className={`flex-1 py-3 text-xs font-bold rounded-2xl transition-all ${addFillType === 'color' ? (theme === 'dark' ? 'bg-[#4D2C19] text-white shadow-sm' : 'bg-white text-[#4D2C19] shadow-sm') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-400' : 'text-gray-500 hover:text-gray-700')}`}
                  >Cor</button>
                  <button 
                    onClick={() => setAddFillType('image')}
                    className={`flex-1 py-3 text-xs font-bold rounded-2xl transition-all ${addFillType === 'image' ? (theme === 'dark' ? 'bg-[#4D2C19] text-white shadow-sm' : 'bg-white text-[#4D2C19] shadow-sm') : (theme === 'dark' ? 'text-gray-500 hover:text-gray-400' : 'text-gray-500 hover:text-gray-700')}`}
                  >Imagem</button>
                </div>

                {addFillType === 'color' ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-6 gap-2">
                      {ITEM_COLORS.map(c => (
                        <button 
                          key={c}
                          onClick={() => setAddColor(c)}
                          className={`w-full aspect-square rounded-xl border-4 transition-all hover:scale-105 active:scale-95 ${addColor === c ? 'border-[#4D2C19] shadow-lg shadow-black/5' : 'border-transparent shadow-sm'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="relative">
                      <input 
                        type="color" 
                        id="item-color-picker"
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer pointer-events-none"
                        value={addColor}
                        onChange={(e) => setAddColor(e.target.value)}
                      />
                      <button 
                        onClick={() => document.getElementById('item-color-picker')?.click()}
                        className={`w-full py-3 font-bold text-xs rounded-xl border border-dashed transition-all active:scale-95 flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-gray-400 hover:bg-white/10' : 'bg-gray-50 border-gray-300 text-gray-600 hover:bg-gray-100'}`}
                      >
                        <Palette size={14} /> Selecionar
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <input 
                      type="text" 
                      placeholder="URL da Imagem"
                      value={addImage}
                      onChange={(e) => setAddImage(e.target.value)}
                      className={`w-full px-6 py-3 border-2 border-transparent transition-all focus:outline-none text-sm rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19] placeholder:text-gray-700' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19] placeholder:text-gray-300'}`}
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Transparência do Item</label>
                    <span className={`text-[10px] font-bold ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`}>
                      {Math.round(addOpacity * 100)}%
                    </span>
                  </div>
                  <input 
                    type="range" min="0" max="1" step="0.05"
                    value={addOpacity}
                    onChange={(e) => setAddOpacity(parseFloat(e.target.value))}
                    className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#4D2C19]"
                  />
                </div>

                <button 
                  onClick={addElement}
                  className="w-full py-4 bg-[#4D2C19] hover:bg-[#3D2213] text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-black/10 active:scale-95"
                >
                  Confirmar e Adicionar
                </button>

                {addError && (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3 bg-red-100 border border-red-200 text-red-700 text-[10px] font-bold rounded-xl text-center"
                  >
                    {addError}
                  </motion.div>
                )}
              </div>
            </section>

            {/* In-Depth Element Editor */}
            {mode === 'edit' && selectedElement && (
              <section className={`mt-auto p-6 rounded-[2rem] space-y-6 border animate-in slide-in-from-bottom-5 ${theme === 'dark' ? 'bg-[#211812]/40 border-white/10 text-white' : 'bg-[#f5ebe0]/40 border-[#4D2C19]/10 text-gray-900'}`}>
                <div className="flex items-center gap-3 text-[#4D2C19]">
                  <Edit3 size={18} />
                  <h3 className="text-xs font-black uppercase tracking-widest">Ajustes Finos</h3>
                </div>
                
                <div className="space-y-5">
                  <div className="space-y-3">
                    <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Cores Rápidas</label>
                    <div className="grid grid-cols-6 gap-2">
                      {COLORS.slice(0, 6).map(c => (
                         <button 
                          key={c}
                          onClick={() => updateElement(selectedId!, { color: c })}
                          className={`w-full aspect-square rounded-xl border-4 transition-all ${selectedElement.color === c ? 'border-[#4D2C19] scale-105' : 'border-transparent opacity-60 hover:opacity-100'}`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                    <div className="relative">
                      <input 
                        type="color" 
                        id="item-color-picker"
                        className="absolute inset-0 opacity-0 w-full h-full cursor-pointer pointer-events-none"
                        value={selectedElement.color}
                        onChange={(e) => updateElement(selectedId!, { color: e.target.value })}
                      />
                      <button 
                        onClick={() => document.getElementById('item-color-picker')?.click()}
                        className={`w-full py-3 font-bold text-xs rounded-xl border border-dashed transition-all active:scale-95 flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-white/5 border-white/10 text-[#4D2C19] hover:bg-white/10' : 'bg-white border-[#4D2C19]/20 text-[#4D2C19] hover:bg-gray-50'}`}
                      >
                        <Palette size={14} /> Selecionar
                      </button>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex justify-between items-end">
                      <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Rotação</label>
                      <span className="text-xs font-bold text-[#4D2C19]">{selectedElement.rotation}°</span>
                    </div>
                    <input 
                      type="range" min="0" max="360" step="1" 
                      value={selectedElement.rotation}
                      onChange={(e) => updateElement(selectedId!, { rotation: parseInt(e.target.value) })}
                      className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#4D2C19]"
                    />
                  </div>

                  <div className="space-y-2">
                    <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Identificador</label>
                    <input 
                      type="text" 
                      value={selectedElement.name}
                      onChange={(e) => updateElement(selectedId!, { name: e.target.value })}
                      className={`w-full px-5 py-3 border-2 border-transparent transition-all focus:outline-none text-sm rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-white text-gray-900 focus:border-[#4D2C19]'}`}
                    />
                  </div>
                </div>
              </section>
            )}
            </div>
            
            {/* Close Button Outside scrolling area */}
            <div className="pt-6 pl-2 h-full pointer-events-none sticky top-0 hidden sm:block">
              <button 
                onClick={() => setIsSidebarOpen(false)} 
                className={`pointer-events-auto p-3 shadow-2xl rounded-xl transition-all active:scale-95 group border-2 ${theme === 'dark' ? 'bg-[#1a1a1a] border-white/10 text-gray-500 hover:text-white hover:bg-red-950/30' : 'bg-white border-gray-100 text-gray-400 hover:text-gray-900 hover:bg-red-50'}`}
                title="Fechar Menu"
              >
                <X size={18}/>
              </button>
            </div>
            
            {/* Mobile close button inside the sidebar div if needed, but the Menu button already toggles it. Let's add a close specifically for small screens if they want it. */}
            {isSidebarOpen && (
              <div className="sm:hidden absolute top-6 right-6 z-[70]">
                <button 
                  onClick={() => setIsSidebarOpen(false)}
                  className={`p-4 rounded-2xl shadow-xl ${theme === 'dark' ? 'bg-white/5 text-white' : 'bg-gray-100 text-gray-900'}`}
                >
                  <X size={24} />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Dimension Popup */}
      <AnimatePresence>
        {showBgPopup && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-6 sm:p-0">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowBgPopup(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-sm overflow-hidden shadow-2xl rounded-[2.5rem] border ${theme === 'dark' ? 'bg-[#121212] border-white/10' : 'bg-white border-gray-100'}`}
            >
              <div className="p-8 space-y-6">
                <div className="space-y-2">
                  <h3 className={`text-xl font-black uppercase tracking-widest ${theme === 'dark' ? 'text-white' : 'text-[#4D2C19]'}`}>Configurar Escala</h3>
                  <p className={`text-xs font-medium ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Defina as dimensões reais da imagem em metros.</p>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Largura (m)</label>
                    <input 
                      type="number" 
                      value={bgWidth}
                      onChange={(e) => setBgWidth(e.target.value)}
                      className={`w-full px-5 py-4 border-2 border-transparent transition-all focus:outline-none text-sm font-bold rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className={`text-[10px] font-black uppercase tracking-widest leading-none ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Altura (m)</label>
                    <input 
                      type="number" 
                      value={bgHeight}
                      onChange={(e) => setBgHeight(e.target.value)}
                      className={`w-full px-5 py-4 border-2 border-transparent transition-all focus:outline-none text-sm font-bold rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                    />
                  </div>
                </div>

                <div className="flex gap-3">
                  <button 
                    onClick={() => setShowBgPopup(false)}
                    className={`flex-1 py-4 font-bold text-sm rounded-2xl transition-all active:scale-95 ${theme === 'dark' ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'}`}
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={confirmBackground}
                    className="flex-[2] py-4 bg-[#4D2C19] hover:bg-[#3D2213] text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-black/10 active:scale-95"
                  >
                    Confirmar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Element Edit Modal */}
      <AnimatePresence>
        {showEditModal && selectedElement && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-6">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
              onClick={() => setShowEditModal(false)}
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`relative w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col md:flex-row gap-0 md:gap-8 items-stretch rounded-[2.5rem] shadow-2xl border ${theme === 'dark' ? 'bg-[#121212] border-white/10' : 'bg-white border-gray-100'}`}
            >
              <div className="flex-1 p-6 sm:p-10 space-y-8">
                <div className="space-y-2">
                  <h3 className={`text-2xl font-black uppercase tracking-widest ${theme === 'dark' ? 'text-white' : 'text-[#4D2C19]'}`}>Editar Dimensões</h3>
                  <p className={`text-xs font-medium ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Ajuste os parâmetros físicos do elemento no mundo real.</p>
                </div>

                <div className="space-y-6">
                  {/* Ponto / Círculo */}
                  {(selectedElement.type === 'point' || ((selectedElement.type === 'shape' || selectedElement.type === 'image') && selectedElement.shapeType === 'circle')) && (
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Diâmetro (Metros)</label>
                      <input 
                        type="number" step="0.1"
                        value={selectedElement.type === 'point' ? selectedElement.radius * 2 : selectedElement.width}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          if (selectedElement.type === 'point') updateElement(selectedId!, { radius: val / 2 });
                          else updateElement(selectedId!, { width: val, height: val });
                        }}
                        className={`w-full px-6 py-4 border-2 border-transparent transition-all focus:outline-none text-base font-bold rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                      />
                    </div>
                  )}

                  {/* Quadrado */}
                  {(selectedElement.type === 'shape' || selectedElement.type === 'image') && selectedElement.shapeType === 'rectangle' && selectedElement.name.toLowerCase().includes('quadrado') && (
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Medida do Lado (Metros)</label>
                        <input 
                          type="number" step="0.1"
                          value={selectedElement.width}
                          onChange={(e) => {
                            const val = parseFloat(e.target.value) || 0;
                            updateElement(selectedId!, { width: val, height: val });
                          }}
                          className={`w-full px-6 py-4 border-2 border-transparent transition-all focus:outline-none text-base font-bold rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Bordas (0 a 1)</label>
                        <input 
                          type="range" min="0" max="1" step="0.05"
                          value={selectedElement.borderRadius || 0}
                          onChange={(e) => updateElement(selectedId!, { borderRadius: parseFloat(e.target.value) })}
                          className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#4D2C19]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Retângulo */}
                  {(selectedElement.type === 'shape' || selectedElement.type === 'image') && selectedElement.shapeType === 'rectangle' && !selectedElement.name.toLowerCase().includes('quadrado') && (
                    <div className="grid grid-cols-2 gap-6">
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Largura (Metros)</label>
                        <input 
                          type="number" step="0.1"
                          value={selectedElement.width}
                          onChange={(e) => updateElement(selectedId!, { width: parseFloat(e.target.value) || 0 })}
                          className={`w-full px-6 py-4 border-2 border-transparent transition-all focus:outline-none text-base font-bold rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Altura (Metros)</label>
                        <input 
                          type="number" step="0.1"
                          value={selectedElement.height}
                          onChange={(e) => updateElement(selectedId!, { height: parseFloat(e.target.value) || 0 })}
                          className={`w-full px-6 py-4 border-2 border-transparent transition-all focus:outline-none text-base font-bold rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                        />
                      </div>
                      <div className="space-y-2 col-span-2">
                        <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Arredondamento dos Cantos (0 a 1)</label>
                        <input 
                          type="range" min="0" max="1" step="0.05"
                          value={selectedElement.borderRadius || 0}
                          onChange={(e) => updateElement(selectedId!, { borderRadius: parseFloat(e.target.value) })}
                          className="w-full h-2 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#4D2C19]"
                        />
                      </div>
                    </div>
                  )}

                  {/* Linha */}
                  {selectedElement.type === 'line' && (
                    <div className="space-y-2">
                      <label className={`text-[10px] font-black uppercase tracking-widest ${theme === 'dark' ? 'text-gray-500' : 'text-gray-400'}`}>Espessura (Metros)</label>
                      <input 
                        type="number" step="0.01" min="0.01"
                        value={selectedElement.strokeWidth || 0.1}
                        onChange={(e) => updateElement(selectedId!, { strokeWidth: parseFloat(e.target.value) || 0.01 })}
                        className={`w-full px-6 py-4 border-2 border-transparent transition-all focus:outline-none text-base font-bold rounded-2xl ${theme === 'dark' ? 'bg-black/40 text-white focus:border-[#4D2C19]' : 'bg-gray-50 text-gray-900 focus:border-[#4D2C19]'}`}
                      />
                    </div>
                  )}
                </div>

                <div className="pt-4 flex flex-col sm:flex-row gap-3">
                  <button 
                    onClick={() => setShowEditModal(false)}
                    className={`flex-1 py-4 font-bold text-sm rounded-2xl transition-all active:scale-95 ${theme === 'dark' ? 'bg-white/5 text-gray-400 hover:text-white' : 'bg-gray-100 text-gray-500 hover:text-gray-700'}`}
                  >
                    Cancelar
                  </button>
                  <button 
                    onClick={() => { setShowEditModal(false); setMode('view'); }}
                    className="flex-[2] py-4 bg-[#4D2C19] hover:bg-[#3D2213] text-white font-bold text-sm rounded-2xl transition-all shadow-lg shadow-black/10 active:scale-95"
                  >
                    Salvar e Fechar
                  </button>
                </div>
              </div>

              {/* Live Preview Side Panel */}
              <div className={`w-full md:w-[24rem] border-t md:border-t-0 md:border-l flex flex-col items-center justify-center p-8 sm:p-12 ${theme === 'dark' ? 'bg-black/40 border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                <div className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-6 sm:mb-8">Demonstração Visual</div>
                <div className="relative w-40 h-40 sm:w-48 sm:h-48 bg-white/5 border border-white/10 rounded-2xl flex items-center justify-center overflow-hidden">
                  <PreviewStage element={selectedElement} theme={theme} />
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Internal Canvas Components ---

function PreviewStage({ element, theme }: any) {
  const size = 150;
  const isCircle = element.type === 'point' || ((element.type === 'shape' || element.type === 'image') && element.shapeType === 'circle');
  const isLine = element.type === 'line';
  const [image] = useImage(element.src);
  
  return (
    <Stage width={size} height={size}>
      <Layer>
        {isCircle ? (
          <Circle 
            x={size/2} y={size/2}
            radius={size/3}
            fill={element.color || element.fill || '#555'}
            stroke={element.stroke || '#fff'}
            strokeWidth={2}
          />
        ) : isLine ? (
          <Line 
            points={[size/4, size/2, size*0.75, size/2]}
            stroke={element.color || '#fff'}
            strokeWidth={Math.max(2, (element.strokeWidth || 0.1) * 30)}
            lineCap="round"
          />
        ) : (
          <Rect 
            x={(size - size/1.5)/2} y={(size - size/1.5)/2}
            width={size/1.5} height={size/1.5}
            fill={element.color || element.fill || '#555'}
            stroke={element.stroke || '#fff'}
            strokeWidth={2}
            cornerRadius={(element.borderRadius || 0) * 50}
          />
        )}
      </Layer>
    </Stage>
  );
}

function BackgroundImage({ src, width, height, scale, offset, opacity }: any) {
  const [image] = useImage(src);
  if (!image) return null;
  return (
    <KonvaImage
      image={image}
      x={offset.x}
      y={offset.y}
      width={width * scale}
      height={height * scale}
      offsetX={(width * scale) / 2}
      offsetY={(height * scale) / 2}
      opacity={opacity}
    />
  );
}

function GridLayer({ scale, offset, width, height, config, isDimmed, gridTheme }: any) {
  const { step } = config;
  
  const startX = Math.floor((-offset.x) / (step * scale)) * step;
  const endX = Math.ceil((width - offset.x) / (step * scale)) * step;
  const startY = Math.floor((-offset.y) / (step * scale)) * step;
  const endY = Math.ceil((height - offset.y) / (step * scale)) * step;

  const lines = [];

  const mainColor = gridTheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)';
  const secondaryColor = gridTheme === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
  const axisColor = gridTheme === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)';
  const textColor = gridTheme === 'dark' ? 'rgba(255,255,255,0.3)' : 'rgba(0,0,0,0.4)';

  for (let x = startX; x <= endX; x += step) {
    const screenX = x * scale + offset.x;
    const isZero = Math.abs(x) < step / 2;
    lines.push(
      <React.Fragment key={`v-${x}`}>
        <Line 
          points={[screenX, 0, screenX, height]} 
          stroke={isDimmed ? (gridTheme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)') : (isZero ? axisColor : secondaryColor)} 
          strokeWidth={isZero ? 3 : 1}
        />
        {step * scale > 40 && !isZero && (
          <Text 
            x={screenX + 5} y={15} 
            text={formatDistance(x)} 
            fontSize={11} 
            fill={textColor}
            fontStyle="bold"
          />
        )}
      </React.Fragment>
    );
  }

  for (let y = startY; y <= endY; y += step) {
    const screenY = y * scale + offset.y;
    const isZero = Math.abs(y) < step / 2;
    lines.push(
      <React.Fragment key={`h-${y}`}>
        <Line 
          points={[0, screenY, width, screenY]} 
          stroke={isDimmed ? (gridTheme === 'dark' ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.04)') : (isZero ? axisColor : secondaryColor)} 
          strokeWidth={isZero ? 3 : 1}
        />
        {step * scale > 40 && !isZero && (
          <Text 
            x={15} y={screenY + 5} 
            text={formatDistance(y)} 
            fontSize={11} 
            fill={textColor}
            fontStyle="bold"
          />
        )}
      </React.Fragment>
    );
  }

  return <Group>{lines}</Group>;
}

function CanvasElement({ element, scale, offset, isSelected, mode, onClick, onContextMenu, onUpdate }: any) {
  const { type, x, y, rotation, color, opacity } = element;
  
  const screenPos = {
    x: x * scale + offset.x,
    y: y * scale + offset.y
  };

  const isMoveDragging = mode === 'move' && isSelected;
  
  const handleDragEnd = (e: any) => {
    if (mode !== 'move' || e.target !== e.currentTarget) return;
    const newX = (e.target.x() - offset.x) / scale;
    const newY = (e.target.y() - offset.y) / scale;
    onUpdate({ x: newX, y: newY });
  };

  const handlePointDragMove = (idx: number, e: any, currentPoints: number[]) => {
    e.cancelBubble = true;
    const newPoints = [...currentPoints];
    newPoints[idx * 2] = e.target.x() / scale;
    newPoints[idx * 2 + 1] = e.target.y() / scale;
    onUpdate({ points: newPoints });
  };

  const handlePointDragEnd = (e: any) => {
    e.cancelBubble = true;
  };

  const commonProps = {
    x: screenPos.x,
    y: screenPos.y,
    rotation: rotation,
    opacity: isMoveDragging ? 1 : (mode === 'move' ? 0.1 : opacity),
    draggable: isMoveDragging,
    onDragEnd: handleDragEnd,
    onClick: onClick,
    onContextMenu: (e: any) => onContextMenu(e, element.id),
    name: element.id,
    shadowBlur: isSelected ? 30 : 0,
    shadowColor: color,
  };

  if (type === 'line') {
    const points = element.points;
    const distance = Math.sqrt(Math.pow(points[2] - points[0], 2) + Math.pow(points[3] - points[1], 2));
    const midX = (points[0] + points[2]) / 2 * scale + screenPos.x;
    const midY = (points[1] + points[3]) / 2 * scale + screenPos.y;

    return (
      <Group {...commonProps}>
        <Line 
          points={points.map((p: number) => p * scale)}
          stroke={color}
          strokeWidth={(element.strokeWidth || 0.1) * scale}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(20, (element.strokeWidth || 0.1) * scale * 2)}
        />
        {isSelected && (
          <>
            {/* Endpoints */}
            {[0, 1].map(idx => (
              <Circle 
                key={idx}
                x={points[idx * 2] * scale}
                y={points[idx * 2 + 1] * scale}
                radius={8}
                fill="#4D2C19"
                stroke="#fff"
                strokeWidth={2}
                draggable
                onDragStart={(e) => { e.cancelBubble = true; }}
                onDragMove={(e) => handlePointDragMove(idx, e, points)}
                onDragEnd={handlePointDragEnd}
              />
            ))}
            {/* Distance Label */}
            <Group x={midX - screenPos.x} y={midY - screenPos.y - 20}>
               <Rect 
                width={60} height={20}
                fill="#4D2C19"
                cornerRadius={5}
                offsetX={30}
               />
               <Text 
                text={`${distance.toFixed(1)}m`}
                fill="#fff"
                fontSize={10}
                fontStyle="bold"
                width={60}
                align="center"
                y={5}
                offsetX={30}
               />
            </Group>
          </>
        )}
      </Group>
    );
  }

  if (type === 'point') {
    return (
      <Circle 
        {...commonProps}
        radius={element.radius * scale}
        fill={color}
        stroke={isSelected ? '#fff' : 'transparent'}
        strokeWidth={3}
      />
    );
  }

  if (type === 'shape') {
    const { shapeType, width, height } = element;
    const fill = element.fill || color;
    const stroke = isSelected ? '#fff' : (element.stroke || 'transparent');
    
    // Adaptive stroke width: use element.strokeWidth as baseline for a 3m object.
    // This keeps the border proportion consistent regardless of scale.
    const baseStroke = element.strokeWidth || 0.05;
    const adaptiveStroke = baseStroke * (width / 3.0);
    const strokeWidth = isSelected ? 3 : (adaptiveStroke * scale);

    if (shapeType === 'rectangle') {
      return (
        <Rect 
          {...commonProps}
          width={width * scale}
          height={height * scale}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          offsetX={(width * scale) / 2}
          offsetY={(height * scale) / 2}
          cornerRadius={scale * 0.15}
        />
      );
    }
    if (shapeType === 'circle') {
      return (
        <Circle 
          {...commonProps}
          radius={(width * scale) / 2}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    }
  }

  if (type === 'image') {
    return <ImageItem {...commonProps} element={element} scale={scale} isSelected={isSelected} mode={mode} />;
  }

  return null;
}

function ImageItem({ element, scale, isSelected, mode, ...props }: any) {
  const [image] = useImage(element.src);
  const [isError, setIsError] = useState(false);
  
  useEffect(() => {
    if (!element.src) return;
    const img = new Image();
    img.src = element.src;
    img.onerror = () => setIsError(true);
    img.onload = () => setIsError(false);
  }, [element.src]);

  const width = element.width * scale;
  const height = element.height * scale;

  let crop = { x: 0, y: 0, width: 0, height: 0 };
  if (image && image.width > 0 && image.height > 0) {
    const imageRatio = image.width / image.height;
    const targetRatio = width / height;

    if (imageRatio > targetRatio) {
      const cropWidth = image.height * targetRatio;
      crop = {
        x: (image.width - cropWidth) / 2,
        y: 0,
        width: cropWidth,
        height: image.height
      };
    } else {
      const cropHeight = image.width / targetRatio;
      crop = {
        x: 0,
        y: (image.height - cropHeight) / 2,
        width: image.width,
        height: cropHeight
      };
    }
  }

  const stroke = isSelected ? '#fff' : (element.stroke || 'transparent');
  
  // Adaptive stroke width for images as well
  const baseStroke = element.strokeWidth || 0.05;
  const adaptiveStroke = baseStroke * ((element.width || 3) / 3.0);
  const strokeWidth = isSelected ? 3 : (adaptiveStroke * scale);

  return (
    <Group {...props}>
      {image && !isError ? (
        <KonvaImage 
          image={image}
          width={width}
          height={height}
          crop={crop}
          offsetX={width / 2}
          offsetY={height / 2}
          stroke={stroke}
          strokeWidth={strokeWidth}
          cornerRadius={element.shapeType === 'circle' ? width / 2 : (scale * 0.15)}
        />
      ) : (
        <Group offsetX={width / 2} offsetY={height / 2}>
          <Rect 
            width={width}
            height={height}
            fill={isError ? "#4a1c1c" : "#333"}
            stroke={stroke}
            strokeWidth={strokeWidth}
            cornerRadius={element.shapeType === 'circle' ? width / 2 : (scale * 0.15)}
            opacity={0.6}
          />
          <Text 
            width={width}
            height={height}
            text={isError ? "Erro ao carregar" : "Carregando..."}
            fontSize={Math.max(10, width * 0.1)}
            fill={isError ? "#ffaaaa" : "#888"}
            align="center"
            verticalAlign="middle"
            fontStyle="bold"
          />
        </Group>
      )}
    </Group>
  );
}

function useImage(src: string) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  
  useEffect(() => {
    if (!src) {
      setImage(null);
      return;
    }

    let isMounted = true;
    const img = new Image();
    
    // We try with anonymous first for CORS compatibility
    img.crossOrigin = 'anonymous';
    
    img.onload = () => {
      if (isMounted) setImage(img);
    };
    
    img.onerror = () => {
      if (!isMounted) return;
      // Fallback: try without crossOrigin
      const fallbackImg = new Image();
      fallbackImg.onload = () => {
        if (isMounted) setImage(fallbackImg);
      };
      fallbackImg.onerror = () => {
        if (isMounted) setImage(null);
      };
      fallbackImg.src = src;
    };

    img.src = src;

    return () => {
      isMounted = false;
      img.onload = null;
      img.onerror = null;
    };
  }, [src]);

  return [image];
}
