import React from 'react';
import { 
  History, 
  ChevronDown, 
  Trash2, 
  Mic, 
  Volume2, 
  RotateCw, 
  PlusCircle, 
  CheckCircle2, 
  Clock, 
  Globe, 
  ListFilter, 
  Sparkles,
  MessageSquare
} from 'lucide-react';
import { CommandHistoryItem } from '../types';

interface CommandHistorySectionProps {
  history: CommandHistoryItem[];
  isOpen: boolean;
  onToggle: () => void;
  onClear: () => void;
  onReplayCommand: (transcript: string) => void;
  assistantName: string;
  languageCode?: string;
}

export const CommandHistorySection: React.FC<CommandHistorySectionProps> = ({
  history,
  isOpen,
  onToggle,
  onClear,
  onReplayCommand,
  assistantName,
  languageCode = 'it-IT'
}) => {
  // Show only the last 3 recognized commands
  const displayedHistory = history.slice(0, 3);
  const isItalian = languageCode.startsWith('it');

  const getActionBadge = (item: CommandHistoryItem) => {
    switch (item.action) {
      case 'ADD_TASK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-emerald-50 text-emerald-800 border border-emerald-200">
            <PlusCircle className="w-3 h-3 text-emerald-600 shrink-0" />
            <span>{isItalian ? 'Promemoria Aggiunto' : 'Added Reminder'}</span>
            {item.scheduledTime && (
              <span className="ml-1 font-mono text-[10px] bg-emerald-100/70 text-emerald-900 px-1 rounded">
                {item.scheduledTime}
              </span>
            )}
          </span>
        );
      case 'COMPLETE_TASK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-teal-50 text-teal-800 border border-teal-200">
            <CheckCircle2 className="w-3 h-3 text-teal-600 shrink-0" />
            <span>{isItalian ? 'Promemoria Completato' : 'Task Completed'}</span>
          </span>
        );
      case 'DELETE_TASK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-rose-50 text-rose-800 border border-rose-200">
            <Trash2 className="w-3 h-3 text-rose-600 shrink-0" />
            <span>{isItalian ? 'Promemoria Eliminato' : 'Task Deleted'}</span>
          </span>
        );
      case 'SNOOZE_TASK':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
            <Clock className="w-3 h-3 text-amber-600 shrink-0" />
            <span>{isItalian ? 'Posticipato' : 'Snoozed'}</span>
          </span>
        );
      case 'CHANGE_LANGUAGE':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-800 border border-blue-200">
            <Globe className="w-3 h-3 text-blue-600 shrink-0" />
            <span>{isItalian ? 'Lingua Modificata' : 'Language Changed'}</span>
          </span>
        );
      case 'LIST_TASKS':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-50 text-purple-800 border border-purple-200">
            <ListFilter className="w-3 h-3 text-purple-600 shrink-0" />
            <span>{isItalian ? 'Elenco Promemoria' : 'Listed Tasks'}</span>
          </span>
        );
      case 'CLEAR_COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-800 border border-slate-200">
            <Trash2 className="w-3 h-3 text-slate-600 shrink-0" />
            <span>{isItalian ? 'Rimossi Completati' : 'Cleared Done'}</span>
          </span>
        );
      case 'GENERAL_OR_HELP':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-[#e5f0ea] text-[#1a3826] border border-[#b8d6c5]">
            <Sparkles className="w-3 h-3 text-[#28553d] shrink-0" />
            <span>{isItalian ? 'Elaborato da AI' : 'AI Processed'}</span>
          </span>
        );
    }
  };

  return (
    <section 
      id="command-history-section"
      className="bg-white/80 backdrop-blur-md border border-[#c4d7cc] hover:border-[#9fbfae] rounded-2xl shadow-xs transition-all overflow-hidden"
    >
      {/* Expandable Header Bar */}
      <div 
        id="command-history-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onToggle();
          }
        }}
        className="w-full flex items-center justify-between p-3 sm:p-3.5 cursor-pointer select-none hover:bg-[#f3f8f5]/60 transition-colors"
      >
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-[#d8ebe0] border border-[#a2c2b0] flex items-center justify-center text-[#28553d] shadow-2xs">
            <History className="w-4 h-4" />
          </div>
          <div className="text-left">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs sm:text-sm font-bold text-[#141b16]">
                {isItalian ? 'Cronologia Comandi' : 'Command History'}
              </h3>
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.2 rounded-full bg-[#d6e7dc] text-[#1a3a26] border border-[#adcbbb]">
                {displayedHistory.length > 0 ? `${displayedHistory.length}` : '0'}
              </span>
            </div>
            <p className="text-[10px] sm:text-[11px] text-[#557362]">
              {isItalian 
                ? 'Ultimi 3 comandi vocali elaborati' 
                : 'Last 3 recognized voice commands'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {history.length > 0 && (
            <button
              id="clear-command-history-btn"
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              title={isItalian ? 'Cancella cronologia' : 'Clear command history'}
              className="p-1.5 text-[#5e7d6c] hover:text-rose-600 hover:bg-rose-50 rounded-lg text-xs transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}

          <div 
            className={`p-1.5 rounded-lg text-[#28553d] transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
          >
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
      </div>

      {/* Expandable Content Area */}
      {isOpen && (
        <div className="border-t border-[#d8e6de] bg-[#f9fbf9] p-3 sm:p-4 space-y-2.5">
          {displayedHistory.length === 0 ? (
            <div className="py-6 px-4 text-center rounded-xl bg-white/70 border border-dashed border-[#c6dbce] space-y-1.5">
              <div className="w-8 h-8 rounded-full bg-[#dcece2] flex items-center justify-center mx-auto text-[#28553d]">
                <Mic className="w-4 h-4" />
              </div>
              <p className="text-xs font-semibold text-[#183424]">
                {isItalian ? 'Nessun comando vocale recente' : 'No recent voice commands'}
              </p>
              <p className="text-[11px] text-[#587564] max-w-xs mx-auto">
                {isItalian 
                  ? `Pronuncia un promemoria per ${assistantName} o tocca un esempio rapido sopra per visualizzare l'elaborazione.`
                  : `Speak a reminder to ${assistantName} or tap a quick phrase above to see the AI processing log.`}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {displayedHistory.map((item, index) => (
                <div
                  key={item.id || index}
                  className="bg-white border border-[#cbe0d4] hover:border-[#96bea9] rounded-xl p-3 space-y-2 shadow-2xs transition-all"
                >
                  {/* Top Row: Action Status & Timestamp */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div>{getActionBadge(item)}</div>
                    <div className="flex items-center gap-1 text-[10px] font-mono text-[#5b7867]">
                      <Clock className="w-3 h-3 text-[#39654d]" />
                      <span>{item.timeStr}</span>
                    </div>
                  </div>

                  {/* Middle Row: Recognized Voice Transcript */}
                  <div className="flex items-start gap-2 text-xs text-[#141b16] font-medium bg-[#f6faf8] border border-[#dae8e0] rounded-lg p-2">
                    <Mic className="w-3.5 h-3.5 text-[#28553d] shrink-0 mt-0.5" />
                    <span className="italic leading-relaxed flex-1">
                      "{item.transcript}"
                    </span>
                  </div>

                  {/* Bottom Row: AI Spoken Response & Replay Action */}
                  <div className="flex items-center justify-between gap-2 text-xs bg-[#edf5f0] border border-[#cae0d3] rounded-lg px-2.5 py-1.5">
                    <div className="flex items-start gap-1.5 text-[#1b3d29] min-w-0 flex-1">
                      <Volume2 className="w-3.5 h-3.5 text-[#28553d] shrink-0 mt-0.5" />
                      <p className="text-[11px] leading-tight truncate sm:whitespace-normal">
                        <strong>{assistantName}:</strong> "{item.spokenResponse}"
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => onReplayCommand(item.transcript)}
                      title={isItalian ? 'Riesegui questo comando vocale' : 'Re-run this voice command'}
                      className="shrink-0 text-[11px] font-semibold text-[#28553d] hover:text-[#143220] hover:bg-[#d5ebdD] border border-[#b4d6c2] bg-white px-2 py-1 rounded-md transition-all flex items-center gap-1 shadow-2xs active:scale-95"
                    >
                      <RotateCw className="w-3 h-3" />
                      <span className="hidden xs:inline">{isItalian ? 'Riesegui' : 'Re-run'}</span>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
};
