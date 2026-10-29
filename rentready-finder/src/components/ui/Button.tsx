import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Variant = 'primary' | 'gold' | 'glass' | 'outline-light' | 'outline-dark' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold tracking-[0.01em] transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-lux focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55 select-none';

const variants: Record<Variant, string> = {
  primary: 'bg-navy-700 text-white shadow-pill hover:bg-navy-900 hover:-translate-y-px active:translate-y-0',
  gold: 'bg-gold text-navy-900 shadow-btn hover:bg-gold-600 hover:text-white active:translate-y-px',
  glass: 'border border-white/25 bg-white/10 text-white backdrop-blur-md hover:bg-white/20',
  'outline-light': 'border border-white/70 bg-transparent text-white hover:border-white hover:bg-white/10',
  'outline-dark': 'border border-mist bg-white text-navy-700 hover:border-navy-700 hover:text-navy-900',
  ghost: 'text-navy-700 hover:text-gold-700',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-4 text-[13px]',
  md: 'h-11 px-6 text-[14px]',
  lg: 'h-12 px-7 text-[15px]',
};

export function buttonClass(variant: Variant = 'primary', size: Size = 'md', extra = '') {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', className = '', icon, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button ref={ref} type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
});

interface LinkButtonProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
}

export function LinkButton({ variant = 'primary', size = 'md', className = '', icon, children, ...rest }: LinkButtonProps) {
  return (
    <a className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </a>
  );
}
