import type { ButtonHTMLAttributes } from 'react';

/**
 * The prototype's buttons: `primary` (Teal gradient), `confirm` (Royal Blue
 * gradient, payment actions only), `secondary` (outlined) and `soft` (the
 * Teal-tinted "+ Add" style). Colour never transitions, only the press scale:
 * a mid-transition colour once failed axe contrast.
 */
type ButtonVariant = 'primary' | 'confirm' | 'secondary' | 'soft';
type ButtonSize = 'md' | 'sm';

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-brand bg-gradient-brand text-brand-contrast shadow-brand',
  confirm: 'bg-confirmation bg-gradient-confirm text-text-inverse shadow-confirm',
  secondary: 'border-[1.5px] border-border-strong bg-surface text-text hover:bg-surface-muted',
  soft: 'border-[1.5px] border-brand-border bg-brand-surface text-brand hover:bg-brand-subtle',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  md: 'min-h-12 rounded-2xl px-6 text-base font-bold tracking-[0.01em]',
  sm: 'min-h-9 rounded-xl px-4 text-xs font-bold tracking-[0.01em]',
};

/** Classes of a button, for links that look like one (navigation stays a link). */
export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md'): string {
  return `inline-flex items-center justify-center gap-2 transition-transform motion-safe:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  type = 'button',
  ...props
}: ButtonProps) {
  return (
    <button type={type} className={`${buttonClasses(variant, size)} ${className}`} {...props} />
  );
}
