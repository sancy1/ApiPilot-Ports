package httpapi

import (
	"net/http"
	"strconv"

	"github.com/apipilot/go/core"
)

// Response helpers — produce ApiPilot envelopes on the wire.
// Mirrors responses.py (Python ASGI) / results.ts (TypeScript) / Results/* (C#).

func writeJSON(w http.ResponseWriter, status int, payload any, extraHeaders map[string]string) {
	writeJSONOpts(w, status, payload, extraHeaders, JsonOptions{})
}

func writeJSONOpts(w http.ResponseWriter, status int, payload any, extraHeaders map[string]string, opts JsonOptions) {
	body, err := Serialize(payload, opts)
	if err != nil {
		// Should never happen for envelope types; fall back to a minimal error.
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"success":false,"error":{"code":"INTERNAL_ERROR","message":"Serialization failed."}}`))
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Length", itoa(len(body)))
	for k, v := range extraHeaders {
		w.Header().Set(k, v)
	}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}

// SendSuccess writes a success envelope.
func SendSuccess(w http.ResponseWriter, requestID string, data any, status int, message *string, extra map[string]any) {
	SendSuccessOpts(w, requestID, data, status, message, extra, JsonOptions{})
}

// SendSuccessOpts is SendSuccess with explicit JSON serialization options.
// The naming/enum/date modes apply to the data payload and meta.extra;
// envelope keys remain pinned.
func SendSuccessOpts(w http.ResponseWriter, requestID string, data any, status int, message *string, extra map[string]any, opts JsonOptions) {
	if status == 0 {
		status = http.StatusOK
	}
	data = transformValue(data, opts)
	if extra != nil {
		extra = transformValue(extra, opts).(map[string]any)
	}
	meta := core.CreateMeta(requestID, extra)
	writeJSONOpts(w, status, core.Success(data, meta, message), nil, opts)
}

// SendPaginated writes a paginated envelope.
func SendPaginated(w http.ResponseWriter, requestID string, data any, pagination core.ApiPagination, status int, message *string) {
	SendPaginatedOpts(w, requestID, data, pagination, status, message, JsonOptions{})
}

// SendPaginatedOpts is SendPaginated with explicit JSON serialization options.
func SendPaginatedOpts(w http.ResponseWriter, requestID string, data any, pagination core.ApiPagination, status int, message *string, opts JsonOptions) {
	if status == 0 {
		status = http.StatusOK
	}
	data = transformValue(data, opts)
	meta := core.CreateMeta(requestID, nil)
	writeJSONOpts(w, status, core.Paginated(data, pagination, meta, message), nil, opts)
}

// SendError writes an error envelope for a standard or custom code.
func SendError(w http.ResponseWriter, requestID string, code core.ApiErrorCode, message string, status int, fields map[string][]string, extraHeaders map[string]string) {
	SendErrorOpts(w, requestID, code, message, status, fields, extraHeaders, JsonOptions{})
}

// SendErrorOpts is SendError with explicit JSON serialization options.
func SendErrorOpts(w http.ResponseWriter, requestID string, code core.ApiErrorCode, message string, status int, fields map[string][]string, extraHeaders map[string]string, opts JsonOptions) {
	if status == 0 {
		status = code.HTTPStatus
	}
	meta := core.CreateMeta(requestID, nil)
	m := meta
	writeJSONOpts(w, status, core.Failure(code, message, &m, fields), extraHeaders, opts)
}

// SendErrorByCode resolves a code string and writes an error envelope.
func SendErrorByCode(w http.ResponseWriter, requestID, codeValue, message string, status int) {
	SendErrorByCodeOpts(w, requestID, codeValue, message, status, JsonOptions{})
}

// SendErrorByCodeOpts is SendErrorByCode with explicit JSON serialization options.
func SendErrorByCodeOpts(w http.ResponseWriter, requestID, codeValue, message string, status int, opts JsonOptions) {
	code, err := core.FromCode(codeValue)
	if err != nil {
		code = core.InternalError
	}
	SendErrorOpts(w, requestID, code, message, status, nil, nil, opts)
}

// SendValidationError writes a VALIDATION_ERROR envelope with field errors.
func SendValidationError(w http.ResponseWriter, requestID string, fields map[string][]string, message string) {
	SendValidationErrorOpts(w, requestID, fields, message, JsonOptions{})
}

// SendValidationErrorOpts is SendValidationError with explicit JSON serialization options.
func SendValidationErrorOpts(w http.ResponseWriter, requestID string, fields map[string][]string, message string, opts JsonOptions) {
	meta := core.CreateMeta(requestID, nil)
	writeJSONOpts(w, http.StatusBadRequest, core.ValidationFailure(fields, meta, message), nil, opts)
}

// SendRateLimited writes a RATE_LIMITED envelope with optional Retry-After.
func SendRateLimited(w http.ResponseWriter, requestID string, retryAfterSeconds int) {
	SendRateLimitedOpts(w, requestID, retryAfterSeconds, JsonOptions{})
}

// SendRateLimitedOpts is SendRateLimited with explicit JSON serialization options.
func SendRateLimitedOpts(w http.ResponseWriter, requestID string, retryAfterSeconds int, opts JsonOptions) {
	headers := map[string]string{}
	if retryAfterSeconds > 0 {
		headers["Retry-After"] = itoa(retryAfterSeconds)
	}
	SendErrorOpts(w, requestID, core.RateLimited, "Too many requests.", 0, nil, headers, opts)
}
