import { Outlet } from 'react-router-dom'
import './CareersLayout.css'

export default function CareersLayout() {
  return (
    <div className="cr">
      <Outlet />
    </div>
  )
}
