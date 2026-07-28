export default function EmployeesLayout({ children }) {
  return <div className="employees-layered"><style>{`
    .employees-layered main { background-color: #e2e8f0 !important; }
    .employees-layered main > div > section { background-color: rgba(203, 213, 225, .72) !important; border-color: #cbd5e1 !important; box-shadow: inset 0 1px 2px rgba(15, 23, 42, .08) !important; }
    .employees-layered main article { background-color: #f8fafc; border-color: #cbd5e1 !important; }
    .employees-layered main section label { background-color: #f8fafc; border-color: #cbd5e1 !important; }
    .employees-layered main section select { background-color: #f8fafc; }
    .employees-layered main a.bg-white, .employees-layered main button.bg-white { background-color: #f8fafc !important; }
    .employees-layered main .bg-slate-50 { background-color: #f1f5f9 !important; }
  `}</style>{children}</div>;
}
