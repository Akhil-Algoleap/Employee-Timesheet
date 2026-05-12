import "./globals.css";

export const metadata = {
  title: "Algoleap | Employee Timesheet System",
  description: "Automated timesheet ingestion and attendance tracking system",
  icons: {
    icon: "/favicon.svg",
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <nav className="navbar">
          <div className="container navbar-content">
            <div className="logo">
              <img src="/logo.png" alt="Algoleap Logo" style={{ height: '32px', display: 'block' }} />
            </div>
            <ul className="nav-links">
              <li>
                <a href="#timesheet-section" className="nav-link">Timesheet</a>
              </li>
              <li>
                <a href="#po-sheet-section" className="nav-link">PO Sheet</a>
              </li>
              <li>
                <a href="#employee-details" className="nav-link">Employee Details</a>
              </li>
              <li>
                <a href="#automation-logs" className="nav-link">Automation Logs</a>
              </li>
            </ul>
          </div>
        </nav>
        <main>{children}</main>
        <footer style={{ padding: '2rem 0', textAlign: 'center', borderTop: '1px solid var(--border)', background: 'var(--secondary)' }}>
          <div className="container">
            <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
              &copy; {new Date().getFullYear()} Algoleap Technologies Pvt. Ltd.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
