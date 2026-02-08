import { useEffect } from 'react'
import { X } from 'lucide-react'

export default function Modal({ data, onClose }) {
  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // Prevent body scroll when modal is open
  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = 'unset'
    }
  }, [])

  if (!data) return null

  return (
    <div 
      className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 animate-fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-2xl p-6 max-w-4xl w-full mx-4 shadow-2xl max-h-[85vh] overflow-auto animate-slide-up custom-scrollbar"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-stone-800 text-lg">{data.title}</h3>
          <button 
            onClick={onClose}
            className="text-stone-400 hover:text-stone-600 transition-colors p-1 rounded-lg hover:bg-stone-100"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="text-stone-600">
          {data.content}
        </div>
      </div>
    </div>
  )
}
