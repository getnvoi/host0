package workspace

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/getnvoi/host0/internal/db"
)

// The credentials a workspace holds of its own, by name.
var credentialNames = []string{"github"}

func (ws *Workspace) credentials() (Credentials, error) {
	var c db.Credential
	err := ws.DB.Where("name = ?", "github").First(&c).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return Credentials{}, nil
	}
	return Credentials{GitHub: c.Value}, err
}

// Replaces the credentials: one given empty is removed.
func (ws *Workspace) PutCredentials(in Credentials) error {
	if in.GitHub == "" {
		return ws.remasked(ws.DB.Where("name = ?", "github").Delete(&db.Credential{}).Error)
	}
	return ws.remasked(ws.DB.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "name"}}, DoUpdates: clause.AssignmentColumns([]string{"value"})}).
		Create(&db.Credential{Name: "github", Value: in.GitHub}).Error)
}

func (ws *Workspace) StoredCredentials() (CredentialsSet, error) {
	out := CredentialsSet{Stored: []string{}}
	var names []string
	if err := ws.DB.Model(&db.Credential{}).Order("name").Pluck("name", &names).Error; err != nil {
		return out, err
	}
	out.Stored = append(out.Stored, names...)
	return out, nil
}

func (ws *Workspace) RemoveCredential(name string) error {
	known := false
	for _, n := range credentialNames {
		known = known || n == name
	}
	if !known {
		return NotFound{fmt.Errorf("no credential %s: the plane holds %v", name, credentialNames)}
	}
	return ws.remasked(ws.DB.Where("name = ?", name).Delete(&db.Credential{}).Error)
}
