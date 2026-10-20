import React, { useState, useMemo } from 'react';
import { Search, Globe, Check, Volume2, X } from 'lucide-react';
import { SUPPORTED_LANGUAGES, LanguageConfig } from '../utils/languages';

interface LanguageSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentLanguageCode: string;
  onSelectLanguage: (lang: LanguageConfig) => void;
  onPreviewVoice?: (lang: LanguageConfig) => void;
}

export const LanguageSelectorModal: React.FC<LanguageSelectorModalProps> = ({
  isOpen,
  onClose,
  currentLanguageCode,
  onSelectLanguage,
  onPreviewVoice,
}) => {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLanguages = useMemo(() => {
    if (!searchQuery.trim()) return SUPPORTED_LANGUAGES;
    const q = searchQuery.toLowerCase().trim();
    return SUPPORTED_LANGUAGES.filter(
      l =>
        l.name.toLowerCase().includes(q) ||
        l.englishName.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q) ||
        l.wakePhrase.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-[#122018]/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-200">
      <div className="max-w-lg w-full bg-[#f7faf8] border border-[#c4d7cc] rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] text-[#141b16]">
        {/* Header */}
        <div className="p-5 pb-3 border-b border-[#c4d7cc] bg-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-[#dcece2] text-[#244f37] flex items-center justify-center border border-[#b2d5c2]">
              <Globe className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-[#141b16]">
                50 Lingue e Voci (50 Languages)
              </h3>
              <p className="text-xs text-[#597866]">
                Seleziona la lingua per la voce dell'assistente e l'interfaccia
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-[#597866] hover:text-[#141b16] hover:bg-[#eaf3ee] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-[#c4d7cc] bg-[#edf4f0]/60">
          <div className="relative">
            <Search className="w-4 h-4 text-[#5b7a68] absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cerca lingua (es. Italiano, English, Español, Français...)"
              className="w-full bg-white border border-[#c4d7cc] rounded-2xl pl-10 pr-4 py-2.5 text-sm text-[#141b16] placeholder:text-[#8ba797] focus:outline-none focus:ring-2 focus:ring-[#28553d] focus:border-transparent transition-all"
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#708e7c] hover:text-[#141b16]"
              >
                ✕
              </button>
            )}
          </div>
          <div className="flex items-center justify-between mt-2 px-1 text-[11px] text-[#5e7d6c]">
            <span>Supporta 50 lingue globali</span>
            <span>{filteredLanguages.length} disponibili</span>
          </div>
        </div>

        {/* Languages List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2 divide-y divide-[#e3eee7]">
          {filteredLanguages.length === 0 ? (
            <div className="text-center py-12 text-[#648472] space-y-1">
              <Globe className="w-8 h-8 mx-auto text-[#9bbdad]" />
              <p className="text-sm font-medium">Nessuna lingua trovata</p>
              <p className="text-xs">Prova a cercare con un altro termine</p>
            </div>
          ) : (
            filteredLanguages.map((lang) => {
              const isSelected = lang.code === currentLanguageCode;
              return (
                <div
                  key={lang.code}
                  className={`pt-2 first:pt-0 flex items-center justify-between p-3 rounded-2xl border transition-all cursor-pointer ${
                    isSelected
                      ? 'bg-[#d8ecdf] border-[#2b593f] shadow-xs'
                      : 'bg-white hover:bg-[#f2f8f4] border-[#c4d7cc]'
                  }`}
                  onClick={() => {
                    onSelectLanguage(lang);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <span className="text-2xl shrink-0" role="img" aria-label={lang.englishName}>
                      {lang.flag}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[#141b16] text-sm truncate">
                          {lang.name}
                        </span>
                        <span className="text-xs text-[#638472] truncate">
                          ({lang.englishName})
                        </span>
                      </div>
                      <div className="text-[11px] text-[#4d6f5c] truncate mt-0.5">
                        Attivazione: <span className="font-mono font-medium">"{lang.wakePhrase}"</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 ml-2">
                    {onPreviewVoice && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onPreviewVoice(lang);
                        }}
                        className="p-2 rounded-xl text-[#39624c] hover:text-[#183925] hover:bg-[#c9e2d3] transition-colors"
                        title={`Ascolta voce in ${lang.name}`}
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    )}
                    {isSelected && (
                      <div className="w-6 h-6 rounded-full bg-[#28553d] text-white flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[#c4d7cc] bg-white flex items-center justify-between text-xs">
          <span className="text-[#5b7a68]">
            La voce si adatta istantaneamente
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-[#28553d] hover:bg-[#1d412d] text-white font-semibold transition-all shadow-xs"
          >
            Chiudi
          </button>
        </div>
      </div>
    </div>
  );
};
