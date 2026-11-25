package core_test

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/sancy1/ApiPilot-Ports/go/core"
)

func strPtr(s string) *string { return &s }

// ---------------------------------------------------------------------------
// Envelope wire shape
// ---------------------------------------------------------------------------

func TestSuccessEnvelopeJSONShape(t *testing.T) {
	meta := core.CreateMeta("req-1", nil)
	env := core.Success(map[string]int{"n": 1}, meta, nil)
	body, err := json.Marshal(env)
	if err != nil {
		t.Fatal(err)
	}
	// Field order: success, data, message, meta.
	wantPrefix := `{"success":true,"data":{"n":1},"message":null,"meta":{`
	if !strings.HasPrefix(string(body), wantPrefix) {
		t.Fatalf("prefix = %s", body)
	}
	var decoded map[string]any
	if err := json.Unmarshal(body, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded["success"] != true {
		t.Fatal("success != true")
	}
	m := decoded["meta"].(map[string]any)
	if m["requestId"] != "req-1" {
		t.Fatalf("requestId = %v", m["requestId"])
	}
	if _, ok := m["timestamp"].(string); !ok {
		t.Fatal("timestamp missing")
	}
	extra, ok := m["extra"].(map[string]any)
	if !ok || len(extra) != 0 {
		t.Fatalf("extra = %v (must be {} not null)", m["extra"])
	}
}

func TestPaginatedEnvelopeHasAllSixFields(t *testing.T) {
	meta := core.CreateMeta("r", nil)
	pag := core.BuildPagination(95, 2, 20)
	env := core.Paginated([]int{1}, pag, meta, nil)
	body, _ := json.Marshal(env)
	var decoded map[string]any
	_ = json.Unmarshal(body, &decoded)
	p := decoded["pagination"].(map[string]any)
	for _, k := range []string{"page", "pageSize", "totalItems", "totalPages", "hasNext", "hasPrevious"} {
		if _, ok := p[k]; !ok {
			t.Fatalf("pagination missing %q: %v", k, p)
		}
	}
	if p["totalPages"] != float64(5) || p["hasNext"] != true || p["hasPrevious"] != true {
		t.Fatalf("pagination = %v", p)
	}
}

func TestErrorEnvelopeOmitsFieldsWhenNil(t *testing.T) {
	meta := core.CreateMeta("r", nil)
	env := core.Failure(core.ResourceNotFound, "nope", &meta, nil)
	body, _ := json.Marshal(env)
	if strings.Contains(string(body), `"fields"`) {
		t.Fatalf("fields should be omitted: %s", body)
	}
	if !strings.Contains(string(body), `"success":false`) {
		t.Fatalf("success flag: %s", body)
	}
}

func TestValidationFailureDefaultMessage(t *testing.T) {
	meta := core.CreateMeta("r", nil)
	env := core.ValidationFailure(map[string][]string{"name": {"required"}}, meta, "")
	if env.Error.Message != "One or more values are invalid." {
		t.Fatalf("message = %q", env.Error.Message)
	}
	if env.Error.Code != "VALIDATION_ERROR" {
		t.Fatalf("code = %q", env.Error.Code)
	}
}

func TestCreateMetaTimestampIsRecent(t *testing.T) {
	before := time.Now().UTC().Add(-time.Second)
	meta := core.CreateMeta("r", nil)
	ts, err := time.Parse(time.RFC3339Nano, meta.Timestamp)
	if err != nil {
		t.Fatalf("timestamp parse: %v", err)
	}
	if ts.Before(before) {
		t.Fatal("timestamp too old")
	}
}

// ---------------------------------------------------------------------------
// Error codes
// ---------------------------------------------------------------------------

func TestFromCodeNormalization(t *testing.T) {
	c, err := core.FromCode("  validation_error  ")
	if err != nil {
		t.Fatal(err)
	}
	if c.Value != "VALIDATION_ERROR" || c.HTTPStatus != 400 {
		t.Fatalf("code = %+v", c)
	}
}

func TestFromCodeCustomGets500(t *testing.T) {
	c, err := core.FromCode("MyCustomCode")
	if err != nil {
		t.Fatal(err)
	}
	if c.Value != "MYCUSTOMCODE" || c.HTTPStatus != 500 {
		t.Fatalf("code = %+v", c)
	}
}

func TestFromCodeEmptyErrors(t *testing.T) {
	if _, err := core.FromCode("   "); err == nil {
		t.Fatal("expected error for empty code")
	}
}

func TestAllStandardHas14Codes(t *testing.T) {
	if len(core.AllStandard()) != 14 {
		t.Fatalf("count = %d", len(core.AllStandard()))
	}
}

// ---------------------------------------------------------------------------
// Field keys
// ---------------------------------------------------------------------------

func TestNormalizeFieldKeyJSONPath(t *testing.T) {
	if got := core.NormalizeFieldKey("$.User.Name"); got != "user.name" {
		t.Fatalf("got %q", got)
	}
}

func TestNormalizeFieldKeyBracketsPreserved(t *testing.T) {
	if got := core.NormalizeFieldKey("Items[0].Name"); got != "items[0].name" {
		t.Fatalf("got %q", got)
	}
}

func TestNormalizeFieldKeyEmpty(t *testing.T) {
	if got := core.NormalizeFieldKey(""); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestResolveKeyTransformCustomWins(t *testing.T) {
	custom := func(raw string) string { return "X:" + raw }
	if got := core.ResolveKeyTransform(custom)("a"); got != "X:a" {
		t.Fatalf("got %q", got)
	}
	if got := core.ResolveKeyTransform(nil)("A"); got != "a" {
		t.Fatalf("default got %q", got)
	}
}
