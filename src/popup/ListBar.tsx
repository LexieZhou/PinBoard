import { useEffect, useRef, useState } from "react";
import type { List, Pin } from "../lib/types";

type Props = {
  lists: List[];
  pins: Pin[];
  activeListId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export default function ListBar({
  lists,
  pins,
  activeListId,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClick(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [menuOpen]);

  const activeList = lists.find((l) => l.id === activeListId);
  const canDelete = lists.length > 1;

  function countFor(id: string) {
    return pins.reduce((n, p) => (p.listIds.includes(id) ? n + 1 : n), 0);
  }

  function handleCreate() {
    const name = window.prompt("New list name");
    if (name && name.trim()) onCreate(name.trim());
  }

  function handleRename() {
    setMenuOpen(false);
    if (!activeList) return;
    const name = window.prompt("Rename list", activeList.name);
    if (name && name.trim() && name.trim() !== activeList.name) {
      onRename(activeList.id, name.trim());
    }
  }

  function handleDelete() {
    setMenuOpen(false);
    if (!activeList || !canDelete) return;
    if (!window.confirm(`Delete list "${activeList.name}"? Pins will be moved to the next list.`)) {
      return;
    }
    onDelete(activeList.id);
  }

  return (
    <div className="relative z-[2000] flex items-center gap-1.5 px-3 py-2 border-b border-zinc-200 bg-zinc-50">
      <div className="flex-1 min-w-0 overflow-x-auto">
        <div className="flex items-center gap-1.5">
          {lists.map((l) => {
            const active = l.id === activeListId;
            return (
              <button
                key={l.id}
                onClick={() => onSelect(l.id)}
                className={
                  "shrink-0 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition " +
                  (active
                    ? "bg-zinc-900 text-white"
                    : "bg-white text-zinc-700 border border-zinc-200 hover:border-zinc-300")
                }
              >
                <span className="truncate max-w-[100px]">{l.name}</span>
                <span className={active ? "text-zinc-400" : "text-zinc-400"}>
                  {countFor(l.id)}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        onClick={handleCreate}
        title="New list"
        className="shrink-0 inline-flex items-center justify-center size-7 rounded-full border border-dashed border-zinc-300 text-zinc-500 hover:text-zinc-900 hover:border-zinc-400 text-sm"
      >
        +
      </button>

      <div className="relative shrink-0" ref={menuRef}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          title="List actions"
          className="inline-flex items-center justify-center size-7 rounded-full text-zinc-500 hover:bg-zinc-200"
        >
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-8 z-[1100] min-w-[140px] rounded-md border border-zinc-200 bg-white py-1 shadow-md">
            <button
              onClick={handleRename}
              className="block w-full text-left px-3 py-1.5 text-xs hover:bg-zinc-50"
            >
              Rename current
            </button>
            <button
              onClick={handleDelete}
              disabled={!canDelete}
              className="block w-full text-left px-3 py-1.5 text-xs text-rose-600 hover:bg-rose-50 disabled:text-zinc-300 disabled:hover:bg-transparent"
            >
              Delete current
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
