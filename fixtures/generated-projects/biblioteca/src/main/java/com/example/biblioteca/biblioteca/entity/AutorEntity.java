package com.example.biblioteca.biblioteca.entity;

import jakarta.persistence.*;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;
import java.util.List;

@Entity
@Table(name = "autor")
public class AutorEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "nombre", columnDefinition = "TEXT", nullable = false)
    private String nombre;

    @ManyToMany(mappedBy = "escritoPors")
    private List<LibroEntity> libros;

    // Constructor vacío
    public AutorEntity() {}

    // Getters y Setters
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getNombre() { return nombre; }
    public void setNombre(String nombre) { this.nombre = nombre; }
    public List<LibroEntity> getLibros() { return libros; }
    public void setLibros(List<LibroEntity> libros) { this.libros = libros; }
}
