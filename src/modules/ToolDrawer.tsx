import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { bus } from '../core/bus';

interface WorkflowDescriptor {
  id: string;
  name: string;
  description: string;
  path: string;
}

interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  policy?: string;
  template: string;
  inputs: Array<{
    name: string;
    label: string;
    placeholder?: string;
  }>;
}

type EmailStatus = 'idle' | 'preview' | 'sending' | 'sent' | 'error';

export function ToolDrawer({ id }: { id: string }) {
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [status, setStatus] = useState<EmailStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [workflows, setWorkflows] = useState<WorkflowDescriptor[]>([]);
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowDefinition | null>(null);
  const [workflowValues, setWorkflowValues] = useState<Record<string, string>>({});
  const [approvalGranted, setApprovalGranted] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState('');
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpFrom, setSmtpFrom] = useState('');
  const [smtpPassword, setSmtpPassword] = useState('');

  useEffect(() => {
    fetch('/workflows/index.json')
      .then((response) => response.json())
      .then((data: WorkflowDescriptor[]) => setWorkflows(data))
      .catch((err) => {
        console.warn('Failed to load workflows', err);
      });
  }, []);

  useEffect(() => {
    const off = bus.on<{ runId: string; text: string }>('stream:final', ({ text }) => {
      setEmailBody(text);
    });
    return () => off();
  }, []);

  const previewEmail = () => {
    setStatus('preview');
    setError(null);
  };

  const sendEmail = async () => {
    setStatus('sending');
    setError(null);
    try {
      await invoke('cmd_send_email', {
        payload: {
          to: emailTo,
          subject: emailSubject,
          body: emailBody,
          approve: approvalGranted,
          smtp:
            smtpHost && smtpUser
              ? {
                  host: smtpHost,
                  port: smtpPort ? Number(smtpPort) : undefined,
                  username: smtpUser,
                  from: smtpFrom || undefined
                }
              : undefined,
          password: smtpPassword || undefined
        }
      });
      setStatus('sent');
    } catch (err: any) {
      setStatus('error');
      setError(err?.message ?? String(err));
    }
  };

  const openWorkflow = async (descriptor: WorkflowDescriptor) => {
    try {
      const response = await fetch(`/${descriptor.path}`);
      const json = await response.json();
      setActiveWorkflow(json);
      setWorkflowValues({});
    } catch (err) {
      console.error('Failed to load workflow', err);
    }
  };

  const runWorkflow = () => {
    if (!activeWorkflow) return;
    const payload = activeWorkflow.inputs.reduce((acc, input) => {
      acc[input.name] = workflowValues[input.name] ?? '';
      return acc;
    }, {} as Record<string, string>);
    const template = activeWorkflow.template.replace(/{{(\w+)}}/g, (_, key) => payload[key] ?? '');
    const composed = `${activeWorkflow.policy ? `${activeWorkflow.policy}\n\n` : ''}${template}`;
    bus.emit('prompt.send', { text: composed });
    setActiveWorkflow(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
      <header
        style={{
          padding: '12px 20px',
          borderBottom: '1px solid rgba(15,23,42,0.08)',
          fontWeight: 600
        }}
      >
        Tools
      </header>
      <div style={{ flex: 1, overflow: 'auto', padding: 20, display: 'flex', flexDirection: 'column', gap: 24 }}>
        <section>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Email</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              value={emailTo}
              onChange={(event) => setEmailTo(event.target.value)}
              placeholder="To"
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(15,23,42,0.12)' }}
            />
            <input
              value={emailSubject}
              onChange={(event) => setEmailSubject(event.target.value)}
              placeholder="Subject"
              style={{ padding: '10px 12px', borderRadius: 8, border: '1px solid rgba(15,23,42,0.12)' }}
            />
            <textarea
              value={emailBody}
              onChange={(event) => setEmailBody(event.target.value)}
              placeholder="Body"
              rows={6}
              style={{
                borderRadius: 10,
                border: '1px solid rgba(15,23,42,0.12)',
                padding: 12,
                resize: 'vertical'
              }}
            />
            <label style={{ fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="checkbox"
                checked={approvalGranted}
                onChange={(event) => setApprovalGranted(event.target.checked)}
              />
              Permit Codex Studio to send email using stored SMTP credentials
            </label>
            <button
              onClick={() => setShowSettings((value) => !value)}
              style={{
                padding: '4px 8px',
                borderRadius: 8,
                border: '1px solid rgba(15,23,42,0.2)',
                background: 'transparent',
                cursor: 'pointer',
                fontSize: 12,
                alignSelf: 'flex-start'
              }}
            >
              {showSettings ? 'Hide SMTP settings' : 'SMTP settings'}
            </button>
            {showSettings && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
                <input
                  value={smtpHost}
                  onChange={(event) => setSmtpHost(event.target.value)}
                  placeholder="SMTP Host"
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(15,23,42,0.12)' }}
                />
                <input
                  value={smtpPort}
                  onChange={(event) => setSmtpPort(event.target.value)}
                  placeholder="SMTP Port (e.g. 587)"
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(15,23,42,0.12)' }}
                />
                <input
                  value={smtpUser}
                  onChange={(event) => setSmtpUser(event.target.value)}
                  placeholder="SMTP Username"
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(15,23,42,0.12)' }}
                />
                <input
                  value={smtpFrom}
                  onChange={(event) => setSmtpFrom(event.target.value)}
                  placeholder="From Address"
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(15,23,42,0.12)' }}
                />
                <input
                  value={smtpPassword}
                  onChange={(event) => setSmtpPassword(event.target.value)}
                  placeholder="SMTP Password (stored securely)"
                  type="password"
                  style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid rgba(15,23,42,0.12)' }}
                />
              </div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              <button
                onClick={previewEmail}
                style={{ padding: '8px 16px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
              >
                Preview
              </button>
              <button
                onClick={sendEmail}
                disabled={!approvalGranted || status === 'sending'}
                style={{
                  padding: '8px 16px',
                  borderRadius: 999,
                  border: 'none',
                  background: approvalGranted ? 'var(--accent)' : 'rgba(15,23,42,0.2)',
                  color: '#fff',
                  cursor: approvalGranted ? 'pointer' : 'not-allowed'
                }}
              >
                {status === 'sending' ? 'Sending…' : 'Send'}
              </button>
            </div>
            {status === 'preview' && (
              <div
                style={{
                  border: '1px solid rgba(15,23,42,0.12)',
                  borderRadius: 8,
                  padding: 12,
                  background: 'rgba(15,23,42,0.03)',
                  fontSize: 13
                }}
              >
                <strong>Preview</strong>
                <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0 0 0' }}>{emailBody}</pre>
              </div>
            )}
            {status === 'sent' && <div style={{ color: 'green', fontSize: 12 }}>Email sent!</div>}
            {status === 'error' && <div style={{ color: 'crimson', fontSize: 12 }}>{error}</div>}
          </div>
        </section>
        <section>
          <h3 style={{ margin: '0 0 8px 0', fontSize: 14 }}>Workflows</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {workflows.map((workflow) => (
              <button
                key={workflow.id}
                onClick={() => openWorkflow(workflow)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: 12,
                  borderRadius: 10,
                  border: '1px solid rgba(15,23,42,0.12)',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              >
                <strong style={{ fontSize: 13 }}>{workflow.name}</strong>
                <span style={{ fontSize: 12, opacity: 0.7 }}>{workflow.description}</span>
              </button>
            ))}
          </div>
          {activeWorkflow && (
            <div
              style={{
                marginTop: 12,
                border: '1px solid rgba(15,23,42,0.12)',
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                flexDirection: 'column',
                gap: 8
              }}
            >
              <strong style={{ fontSize: 14 }}>{activeWorkflow.name}</strong>
              <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>{activeWorkflow.description}</p>
              {activeWorkflow.policy && (
                <pre
                  style={{
                    background: 'rgba(15,23,42,0.04)',
                    padding: 10,
                    borderRadius: 8,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap'
                  }}
                >
                  {activeWorkflow.policy}
                </pre>
              )}
              {activeWorkflow.inputs.map((input) => (
                <input
                  key={input.name}
                  value={workflowValues[input.name] ?? ''}
                  onChange={(event) =>
                    setWorkflowValues((prev) => ({ ...prev, [input.name]: event.target.value }))
                  }
                  placeholder={input.placeholder ?? input.label}
                  style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(15,23,42,0.12)' }}
                />
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => setActiveWorkflow(null)}
                  style={{ padding: '8px 16px', borderRadius: 999, border: 'none', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={runWorkflow}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 999,
                    border: 'none',
                    background: 'var(--accent)',
                    color: '#fff',
                    cursor: 'pointer'
                  }}
                >
                  Run
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
