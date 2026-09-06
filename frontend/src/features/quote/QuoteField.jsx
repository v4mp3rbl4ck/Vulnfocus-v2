import React from 'react';
import { useLanguage } from '../../context/LanguageContext';

/**
 * Renderiza una pregunta del catálogo según su tipo.
 *
 * Un único componente para todos los tipos evita que cada paso reimplemente
 * etiquetas, ayudas, estados de error y accesibilidad, que es donde se cuelan
 * las inconsistencias.
 */
const QuoteField = ({ question, value, onChange, error, idPrefix }) => {
  const { language } = useLanguage();
  const label = question.labels[language] || question.labels.es;
  const help = question.help ? question.help[language] || question.help.es : null;

  const fieldId = `${idPrefix}-${question.id}`;
  const helpId = help ? `${fieldId}-help` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  const optionLabel = (option) => option.labels[language] || option.labels.es;

  return (
    <div className={`quote-field quote-field-${question.type}`}>
      {question.type === 'boolean' ? (
        <label className="quote-switch" htmlFor={fieldId}>
          <input
            type="checkbox"
            id={fieldId}
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            aria-describedby={describedBy}
          />
          <span className="quote-switch-label">{label}</span>
        </label>
      ) : (
        <span className="quote-field-label" id={`${fieldId}-label`}>
          {label}
        </span>
      )}

      {help && (
        <p className="quote-field-help" id={helpId}>
          {help}
        </p>
      )}

      {question.type === 'number' && (
        <input
          type="number"
          id={fieldId}
          className={`form-input quote-number ${error ? 'input-error' : ''}`}
          value={value ?? ''}
          min={question.min}
          max={question.max}
          step={1}
          inputMode="numeric"
          aria-labelledby={`${fieldId}-label`}
          aria-describedby={describedBy}
          aria-invalid={error ? 'true' : undefined}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === '' ? '' : Number(raw));
          }}
        />
      )}

      {question.type === 'select' && (
        <div className="quote-options" role="radiogroup" aria-labelledby={`${fieldId}-label`}>
          {question.options.map((option) => (
            <label
              key={option.value}
              className={`quote-option ${value === option.value ? 'quote-option-selected' : ''}`}
            >
              <input
                type="radio"
                name={fieldId}
                value={option.value}
                checked={value === option.value}
                onChange={() => onChange(option.value)}
              />
              <span>{optionLabel(option)}</span>
            </label>
          ))}
        </div>
      )}

      {question.type === 'multiselect' && (
        <div className="quote-options" role="group" aria-labelledby={`${fieldId}-label`}>
          {question.options.map((option) => {
            const selected = Array.isArray(value) && value.includes(option.value);
            return (
              <label
                key={option.value}
                className={`quote-option ${selected ? 'quote-option-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  value={option.value}
                  checked={selected}
                  onChange={() => {
                    const current = Array.isArray(value) ? value : [];
                    onChange(
                      selected
                        ? current.filter((v) => v !== option.value)
                        : [...current, option.value],
                    );
                  }}
                />
                <span>{optionLabel(option)}</span>
              </label>
            );
          })}
        </div>
      )}

      {error && (
        <p className="error-text" id={errorId} role="alert">
          {error}
        </p>
      )}
    </div>
  );
};

export default QuoteField;
