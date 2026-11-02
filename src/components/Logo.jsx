export default function Logo({ size = 32 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden="true">
      <rect width="512" height="512" rx="112" fill="#256b5b" />
      <circle cx="256" cy="256" r="154" fill="none" stroke="#fff" strokeWidth="34" />
      <circle cx="256" cy="256" r="50" fill="#fff" />
    </svg>
  )
}
