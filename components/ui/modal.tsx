"use client";

import type { ReactNode } from "react";
import { useState, useEffect } from "react";
import { type LucideIcon, X, Check } from "lucide-react";
import { useBackHandler } from "@/lib/back-handler";

/* ── Confirm Dialog (center) ── */
export type ConfirmDialogProps = {
  title: string;
  message?: string;
  icon?: LucideIcon;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "action" | "default";
  overlayClassName?: string;
  dialogClassName?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  title,
  message,
  icon: Icon,
  confirmLabel = "确认",
  cancelLabel = "取消",
  variant = "default",
  overlayClassName,
  dialogClassName,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // 这些弹窗都是条件挂载的，所以"挂载即注册"正好等于"打开即入栈"
  useBackHandler(true, onCancel);
  return (
    <div className={`modal-overlay ${overlayClassName ?? ""}`} data-ui="modal" onClick={onCancel}>
      <div className={`modal-dialog ${dialogClassName ?? ""}`} data-ui="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" data-ui="modal-header">
          {Icon && <div className="ui-icon-circle" data-variant={variant === "default" ? undefined : variant}><Icon size={20} /></div>}
          <h3 className="modal-title">{title}</h3>
        </div>
        {message && <div className="modal-body" data-ui="modal-body"><p>{message}</p></div>}
        <div className="modal-footer" data-ui="modal-footer">
          {cancelLabel && <button className="ui-btn ui-btn-ghost" onClick={onCancel}>{cancelLabel}</button>}
          <button className={`ui-btn ui-btn-${variant === "default" ? "primary" : variant}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}

/* ── Content Dialog (center, custom body) ── */
export type ContentDialogProps = {
  title: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
};

export function ContentDialog({
  title,
  confirmLabel = "\u4FDD\u5B58",
  cancelLabel = "\u53D6\u6D88",
  onConfirm,
  onCancel,
  children,
}: ContentDialogProps) {
  useBackHandler(true, onCancel);
  return (
    <div className="modal-overlay" data-ui="modal" onClick={onCancel}>
      <div className="modal-dialog" data-ui="modal-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" data-ui="modal-header">
          <h3 className="modal-title">{title}</h3>
        </div>
        <div className="modal-body" data-ui="modal-body" style={{ textAlign: "left", width: "100%" }}>
          {children}
        </div>
        <div className="modal-footer" data-ui="modal-footer">
          {cancelLabel && <button className="ui-btn ui-btn-outline" onClick={onCancel}>{cancelLabel}</button>}
          {confirmLabel && <button className="ui-btn ui-btn-primary" onClick={onConfirm}>{confirmLabel}</button>}
        </div>
      </div>
    </div>
  );
}

/* ── Bottom Sheet ── */
export type BottomSheetProps = {
  title: string;
  onClose: () => void;
  onDone?: () => void;
  children: ReactNode;
};

export function BottomSheet({
  title,
  onClose,
  onDone,
  children,
}: BottomSheetProps) {
  useBackHandler(true, onClose);
  return (
    <div className="modal-overlay" data-ui="modal" onClick={onClose}>
      <div className="modal-sheet" data-ui="modal-sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" data-ui="modal-header">
          <button className="modal-header-btn modal-header-btn-muted" onClick={onClose}><X size={18} /></button>
          <h3 className="modal-title">{title}</h3>
          {onDone ? (
            <button className="modal-header-btn modal-header-btn-action" onClick={onDone}><Check size={18} /></button>
          ) : (
            <span style={{ width: 28 }} />
          )}
        </div>
        <div className="modal-body" data-ui="modal-body">
          {children}
        </div>
      </div>
    </div>
  );
}

/* ── Text Expand Modal ── */
export function TextExpandModal({
  title,
  value,
  onChange,
  placeholder,
  className,
  onClose,
}: {
  title: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);

  useBackHandler(true, onClose);
  useEffect(() => { setDraft(value); }, [value]);

  return (
    <div className="modal-overlay" data-ui="modal" onClick={onClose}>
      <div className="modal-expand" data-ui="modal-expand" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" data-ui="modal-header">
          <button className="modal-header-btn modal-header-btn-muted" onClick={onClose}><X size={18} /></button>
          <span className="modal-header-title">{title}</span>
          <button className="modal-header-btn modal-header-btn-action" onClick={() => { onChange(draft); onClose(); }}><Check size={18} /></button>
        </div>
        <div className="modal-expand-body" data-ui="modal-body">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={placeholder}
            className={`ui-textarea ${className ?? ""}`}
          />
        </div>
      </div>
    </div>
  );
}
