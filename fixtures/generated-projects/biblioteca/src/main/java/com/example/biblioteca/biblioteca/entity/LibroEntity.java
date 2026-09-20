package com.example.biblioteca.biblioteca.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.List;

@Entity
@Table(name = "libro")
public class LibroEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "titulo", columnDefinition = "TEXT", nullable = false)
    private String titulo;

    @Column(name = "isbn", columnDefinition = "TEXT", nullable = false)
    private String isbn;

    @Column(name = "fecha_publicacion")
    private LocalDate fechaPublicacion;

    @ManyToMany
    @JoinTable(
        name = "autor_libro",
        joinColumns = @JoinColumn(name = "libro_id"),
        inverseJoinColumns = @JoinColumn(name = "autor_id")
    )
    private List<AutorEntity> escritoPors;

    // Constructor vacío
    public LibroEntity() {}

    // Getters y Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getTitulo() { return titulo; }
    public void setTitulo(String titulo) { this.titulo = titulo; }
    public String getIsbn() { return isbn; }
    public void setIsbn(String isbn) { this.isbn = isbn; }
    public LocalDate getFechaPublicacion() { return fechaPublicacion; }
    public void setFechaPublicacion(LocalDate fechaPublicacion) { this.fechaPublicacion = fechaPublicacion; }
    public List<AutorEntity> getEscritoPors() { return escritoPors; }
    public void setEscritoPors(List<AutorEntity> escritoPors) { this.escritoPors = escritoPors; }
}
