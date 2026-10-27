export function CoffeeButton({ small }) {
  return (
    <a className={`bmc ${small ? 'small' : ''}`} href="https://buymeacoffee.com/aurons" target="_blank" rel="noopener noreferrer">
      <span className="bmc-cup">☕</span>
      <span className="bmc-text">Buy me a coffee</span>
    </a>
  )
}
