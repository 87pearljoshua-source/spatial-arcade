import { useState } from 'react';
import { X, Play, RefreshCw, BarChart2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { ResolutionBenchmarkRunner, type ResolutionBenchmarkResult } from '../cv/resolutionBenchmark';

interface ResolutionBenchmarkModalProps {
  isOpen: boolean;
  onClose: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onSelectResolution: (width: number) => void;
  currentResolution: number;
}

export function ResolutionBenchmarkModal({
  isOpen,
  onClose,
  videoRef,
  onSelectResolution,
  currentResolution
}: ResolutionBenchmarkModalProps) {
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [progress, setProgress] = useState<{ res: number; current: number; total: number } | null>(null);
  const [results, setResults] = useState<Record<number, ResolutionBenchmarkResult>>({});
  const [statusMessage, setStatusMessage] = useState<string>('Hold phone stationary aimed at the TV/Border, then run the test.');

  if (!isOpen) return null;

  const runFullBenchmark = async () => {
    if (!videoRef.current || videoRef.current.readyState < 2) {
      setStatusMessage('Error: Video feed is not ready. Start camera or test feed first.');
      return;
    }

    setIsRunning(true);
    setStatusMessage('Running benchmark: Collecting 60 stationary frames for each resolution...');
    const resolutions = [160, 320, 640];
    const newResults: Record<number, ResolutionBenchmarkResult> = {};

    try {
      for (const res of resolutions) {
        setProgress({ res, current: 0, total: 60 });
        const resData = await ResolutionBenchmarkRunner.runBenchmarkOnVideo(
          videoRef.current,
          res,
          60,
          (cur, tot) => setProgress({ res, current: cur, total: tot })
        );
        newResults[res] = resData;
        setResults({ ...newResults });
      }
      setStatusMessage('Benchmark complete. Results calculated from 60 consecutive stationary frames per resolution.');
    } catch (err: any) {
      setStatusMessage(`Benchmark failed: ${err.message || String(err)}`);
    } finally {
      setIsRunning(false);
      setProgress(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 w-full max-w-2xl rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
          <div className="flex items-center gap-2">
            <BarChart2 className="w-5 h-5 text-indigo-400" />
            <div>
              <h2 className="text-base font-bold text-white uppercase tracking-wider">RESOLUTION BENCHMARK TEST</h2>
              <p className="text-xs text-slate-400">Objective comparison of 160 vs 320 vs 640 px optical border tracking</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 overflow-y-auto space-y-4 text-xs font-mono">
          <div className="bg-slate-950/80 p-3 rounded-lg border border-slate-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-slate-300">
              <span className="font-bold text-amber-300">Methodology:</span> Measures 60 consecutive frames per resolution with stationary camera. Calculates objective detection FPS, processing latency, standard deviation Jitter X / Jitter Y, and Total RMS Jitter.
            </div>
          </div>

          {/* Progress Indicator */}
          {isRunning && progress && (
            <div className="bg-indigo-950/40 border border-indigo-700/60 p-3 rounded-lg">
              <div className="flex justify-between mb-1.5 text-indigo-300 font-bold">
                <span>Testing {progress.res} px Resolution</span>
                <span>Frame {progress.current} / {progress.total}</span>
              </div>
              <div className="w-full bg-slate-800 h-2 rounded-full overflow-hidden">
                <div
                  className="bg-indigo-500 h-full transition-all duration-75"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
          )}

          {/* Results Table */}
          <div className="border border-slate-800 rounded-lg overflow-hidden bg-slate-950">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-800">
                  <th className="p-2.5">RESOLUTION</th>
                  <th className="p-2.5">AVG TIME</th>
                  <th className="p-2.5">MEASURED FPS</th>
                  <th className="p-2.5">DETECTION %</th>
                  <th className="p-2.5">JITTER X</th>
                  <th className="p-2.5">JITTER Y</th>
                  <th className="p-2.5">RMS JITTER</th>
                  <th className="p-2.5 text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 text-slate-300">
                {[160, 320, 640].map((res) => {
                  const r = results[res];
                  const isCurrent = currentResolution === res;
                  return (
                    <tr key={res} className={`hover:bg-slate-900/40 ${isCurrent ? 'bg-indigo-950/20' : ''}`}>
                      <td className="p-2.5 font-bold text-white flex items-center gap-1.5">
                        {res} px
                        {isCurrent && (
                          <span className="text-[10px] bg-indigo-500/20 text-indigo-300 px-1 py-0.2 rounded border border-indigo-600">
                            ACTIVE
                          </span>
                        )}
                      </td>
                      <td className="p-2.5">
                        {r ? `${r.avgProcessingTimeMs.toFixed(2)} ms` : '--'}
                      </td>
                      <td className="p-2.5">
                        {r ? (
                          <span className={`font-bold ${r.estimatedFps >= 45 ? 'text-emerald-400' : r.estimatedFps >= 20 ? 'text-amber-400' : 'text-rose-400'}`}>
                            {r.estimatedFps.toFixed(1)} FPS
                          </span>
                        ) : '--'}
                      </td>
                      <td className="p-2.5">
                        {r ? (
                          <span className={r.successRatePercent >= 90 ? 'text-emerald-400 font-bold' : 'text-amber-400'}>
                            {r.successRatePercent.toFixed(0)}%
                          </span>
                        ) : '--'}
                      </td>
                      <td className="p-2.5 font-mono">
                        {r ? r.jitterX.toFixed(4) : '--'}
                      </td>
                      <td className="p-2.5 font-mono">
                        {r ? r.jitterY.toFixed(4) : '--'}
                      </td>
                      <td className="p-2.5 font-mono font-bold text-cyan-300">
                        {r ? r.totalRmsJitter.toFixed(4) : '--'}
                      </td>
                      <td className="p-2.5 text-right">
                        <button
                          onClick={() => onSelectResolution(res)}
                          disabled={isCurrent}
                          className={`px-2 py-1 rounded text-[11px] font-bold cursor-pointer transition ${
                            isCurrent
                              ? 'bg-slate-800 text-slate-500 cursor-default'
                              : 'bg-indigo-600 hover:bg-indigo-500 text-white'
                          }`}
                        >
                          {isCurrent ? 'Selected' : 'Use'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Status Message */}
          <div className="text-slate-400 text-[11px]">
            {statusMessage}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/60 flex items-center justify-between">
          <div className="text-[11px] text-slate-500">
            Default recommended: 640px (with auto-fallback to 320px if phone latency &gt; 45ms)
          </div>

          <div className="flex gap-2">
            <button
              onClick={runFullBenchmark}
              disabled={isRunning}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-bold rounded-lg flex items-center gap-2 cursor-pointer transition text-xs"
            >
              {isRunning ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {isRunning ? 'Benchmarking...' : 'RUN BENCHMARK (60 FRAMES)'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
