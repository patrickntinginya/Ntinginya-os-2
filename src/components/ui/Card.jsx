export default function Card({ as: Tag = 'div', className = '', children, ...rest }) {
  return (
    <Tag className={`card ${className}`} {...rest}>
      {children}
    </Tag>
  )
}
