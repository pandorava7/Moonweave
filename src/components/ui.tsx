import { forwardRef, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'

function cx(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ')
}

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'outline' | 'ghost' | 'destructive'; size?: 'default' | 'icon' }>(
  ({ className, variant = 'default', size = 'default', type = 'button', ...props }, ref) => (
    <button ref={ref} type={type} data-slot="button" data-variant={variant} data-size={size} className={cx('ui-button', className)} {...props} />
  ),
)
Button.displayName = 'Button'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} data-slot="input" className={cx('ui-input', className)} {...props} />,
)
Input.displayName = 'Input'

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, ...props }, ref) => <select ref={ref} data-slot="select" className={cx('ui-select', className)} {...props} />,
)
Select.displayName = 'Select'

interface SliderProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  value: number
  onValueChange(value: number): void
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, value, onValueChange, ...props }, ref) => (
    <input ref={ref} type="range" data-slot="slider" className={cx('ui-slider', className)} value={value} onChange={event => onValueChange(Number(event.target.value))} {...props} />
  ),
)
Slider.displayName = 'Slider'

export function Dialog({ open, children, onOpenChange }: { open: boolean; children: ReactNode; onOpenChange(open: boolean): void }) {
  if (!open) return null
  return <div data-slot="dialog" className="modal-backdrop" role="presentation" onMouseDown={() => onOpenChange(false)}>{children}</div>
}

export function DialogContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div data-slot="dialog-content" role="dialog" aria-modal="true" className={cx('settings-modal', className)} onMouseDown={event => event.stopPropagation()}>{children}</div>
}

export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return <span data-slot="badge" className={cx('ui-badge', className)}>{children}</span>
}
