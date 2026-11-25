package core

import (
	"strings"
	"time"
)

// ApiMeta is the meta object carried by every envelope.
type ApiMeta struct {
	RequestID string         `json:"requestId"`
	Timestamp string         `json:"timestamp"`
	Extra     map[string]any `json:"extra"`
}

// ApiPagination is the pagination block on paginated envelopes.
// All six fields are required.
type ApiPagination struct {
	Page        int  `json:"page"`
	PageSize    int  `json:"pageSize"`
	TotalItems  int  `json:"totalItems"`
	TotalPages  int  `json:"totalPages"`
	HasNext     bool `json:"hasNext"`
	HasPrevious bool `json:"hasPrevious"`
}

// CreateMeta creates a meta object with the given request id and current timestamp.
func CreateMeta(requestID string, extra map[string]any) ApiMeta {
	if extra == nil {
		extra = map[string]any{}
	}
	return ApiMeta{
		RequestID: requestID,
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Extra:     extra,
	}
}

// SuccessEnvelope is the success envelope: { success, data, message, meta }.
type SuccessEnvelope struct {
	Success bool    `json:"success"`
	Data    any     `json:"data"`
	Message *string `json:"message"`
	Meta    ApiMeta `json:"meta"`
}

// PaginatedEnvelope is the paginated envelope: success envelope + pagination sibling.
type PaginatedEnvelope struct {
	Success    bool          `json:"success"`
	Data       any           `json:"data"`
	Message    *string       `json:"message"`
	Meta       ApiMeta       `json:"meta"`
	Pagination ApiPagination `json:"pagination"`
}

// ApiError is the error object inside an error envelope.
type ApiError struct {
	Code    string              `json:"code"`
	Message string              `json:"message"`
	Fields  map[string][]string `json:"fields,omitempty"`
}

// ErrorEnvelope is the error envelope: { success: false, error, meta? }.
type ErrorEnvelope struct {
	Success bool     `json:"success"`
	Error   ApiError `json:"error"`
	Meta    *ApiMeta `json:"meta,omitempty"`
}

// Success builds a success envelope.
func Success(data any, meta ApiMeta, message *string) SuccessEnvelope {
	return SuccessEnvelope{Success: true, Data: data, Message: message, Meta: meta}
}

// Paginated builds a paginated envelope.
func Paginated(data any, pagination ApiPagination, meta ApiMeta, message *string) PaginatedEnvelope {
	return PaginatedEnvelope{Success: true, Data: data, Message: message, Meta: meta, Pagination: pagination}
}

// Failure builds an error envelope. fields is included only when non-nil.
func Failure(code ApiErrorCode, message string, meta *ApiMeta, fields map[string][]string) ErrorEnvelope {
	return ErrorEnvelope{
		Success: false,
		Error:   ApiError{Code: code.Value, Message: message, Fields: fields},
		Meta:    meta,
	}
}

// ValidationFailure builds a VALIDATION_ERROR envelope with field errors.
func ValidationFailure(fields map[string][]string, meta ApiMeta, message string) ErrorEnvelope {
	if strings.TrimSpace(message) == "" {
		message = "One or more values are invalid."
	}
	m := meta
	return Failure(ValidationError, message, &m, fields)
}
